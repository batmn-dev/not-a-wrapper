# 15. Presentation reveal commits above the message throttle

- Status: superseded (2026-07-27 — the reveal was removed unmerged the same
  day it passed its gate; the streaming-architecture review in
  `docs/gameplans/streaming-rendering-convex-implementation-plan.md` rejected
  the second prefix-reveal scheduler in favor of making the raw rendering
  path fast enough to present provider deltas directly. The implementation
  lives on PR #130 (`darknight/the-black-glove` pre-revert history) for
  fixture/measurement salvage. Accepted earlier that day with merge gate
  passed, see `docs/measurements/2026-07-27-presentation-reveal-decision.md`)
- Date: 2026-07-27
- Related: ADR-0009 (durable turn runtime — 750 ms snapshot cadence, unchanged),
  ADR-0011 (settlement — terminal writes the reveal must flush on, unchanged);
  `docs/measurements/2026-07-23-pr2-throttle-selection.md` (the 50 ms throttle
  this deliberately renders more often than),
  `docs/measurements/2026-07-27-presentation-reveal-decision.md` (the measured
  merge-gate artifact for this decision),
  `docs/gameplans/smooth-text-streaming-implementation-plan.md` (the plan this
  records the decision for).

## Context

The 50 ms AI SDK message throttle (`lib/chat-performance/message-throttle.ts`)
ended the tab-freezing renderer saturation, but it makes streamed prose arrive
in visible multi-word lumps. The product bar chosen for fixing this is ChatGPT
word-fade parity: text appears word-by-word with a brief fade, at ≤ 1 word per
visual update at typical token rates. That requires visual updates *more*
frequent than every 50 ms — which reads as a contradiction of the throttle the
codebase just fought to keep.

## Decision

A client-side **Presentation reveal** (see CONTEXT.md) renders a word-boundary
prefix of the canonical text, advanced by a rAF-gated adaptive scheduler, with
newly revealed words faded in via CSS. It deliberately issues React commits
more often than the 50 ms throttle delivers canonical updates — that is not a
regression of the throttle's purpose, because the two bound different costs:

- The **throttle** bounds *canonical reconciliation* cost: each AI SDK
  notification re-renders every part renderer, re-parses the full Markdown
  block split, and re-enters the code-block effect. It stays at 50 ms,
  permanent, untouched.
- The **reveal** bounds nothing and costs little by construction: each reveal
  commit changes only the displayed prefix of the *terminal prose block* of
  the one live message (per-block memoization isolates it), never a code
  block, never a settled block, never any other row.

The gate for shipping is therefore **bounded cost, not commit parity**: on the
deterministic stress streams, long main-thread tasks and dropped frames must
stay at the flags-on baseline, and React Profiler must show reveal commits
touching only the terminal-block subtree. Reveal state is display-only and
never persisted; canonical AI SDK / Convex state is unchanged and always
authoritative. Terminal events, Stop, approvals, errors, and non-prefix
canonical changes flush or reset the reveal synchronously. Reduced motion
renders canonical text directly with no reveal structure. No feature flag:
the reveal ships as permanent behavior (rollback = revert), matching the
2026-07-23 flag-collapse posture.

## Considered options

- **Retune the throttle (50 ms → 32 ms)** — rejected: still lumps words
  (visual cadence remains tied to canonical reconciliation cost), and it
  raises the cost the throttle exists to bound. Measured only as a baseline
  comparison variant.
- **Post-Markdown DOM animation (Lobe-UI-style, MutationObserver + span
  wrapping outside React)** — rejected: zero extra commits, but a second
  writer to DOM that React owns; fragile against per-block memoization,
  Shiki's async `innerHTML` replacement, links/KaTeX, and manual stale-wrapper
  cleanup on branch switch/regeneration — exactly the correction paths the
  durable runtime makes common.
- **Server-side `smoothStream` re-chunking** — rejected: it changes the wire
  stream that also feeds durable persistence and would add server-imposed
  latency to canonical content; smoothing must be presentation-only.
- **Commit-parity gate (reveal commits ≤ 50 ms cadence)** — rejected: caps
  reveal granularity at today's chunkiness; word-level parity is unreachable
  under it.
