# 16. Streaming rendering: direct HTTP foreground, incremental projection, Convex durability

- Status: accepted (2026-07-27)
- Date: 2026-07-27
- Related: ADR-0009 (durable turn runtime — 750 ms snapshot cadence, unchanged),
  ADR-0011 (settlement, unchanged), ADR-0013 (back-navigation detach, unchanged),
  ADR-0015 (presentation reveal — superseded by this decision);
  `docs/gameplans/streaming-rendering-convex-implementation-plan.md` (the plan),
  `docs/measurements/2026-07-27-streaming-renderer-baseline.md` (before),
  `docs/measurements/2026-07-27-streaming-renderer-results.md` (after).

## Context

Assistant responses must appear immediately, stay smooth as they grow, and
recover durably across navigation, reloads, tabs, and devices. Two prior
efforts shaped this decision. The 2026-07-23 chat-responsiveness work added a
50 ms AI SDK notification throttle and a 300 ms growing-code highlight
throttle because the renderer was intrinsically expensive: the full
accumulated Markdown was re-parsed on every displayed-text update, and Shiki
shipped statically with 35 eager grammars. PR #130 (ADR-0015) then attacked
the visible lumpiness of the 50 ms cadence with a presentation reveal — a
second, display-only prefix scheduler that faded words in above the throttle.

The 2026-07-27 streaming-architecture review rejected the reveal: it held
displayed text behind a second timer, wrapped every streamed word in DOM
spans, and treated renderer slowness as a presentation problem. The correct
order is to make the raw rendering path fast enough to present provider
deltas directly, then pick the simplest cadence.

## Decision

### Ownership model

```text
Initiating visible tab
Provider → direct HTTP stream → AI SDK local message state
         → incremental Markdown projection
         → stable memoized blocks + one bounded mutable region
         → lazy/throttled syntax highlighting

Durability and shared observation
Provider stream → durable snapshot writer (750 ms) → Convex
Convex → reactive run/message projection
       → navigation recovery, reload recovery, other tabs/devices, terminal truth
```

- The initiating tab's token-to-paint path never routes through Convex.
- AI SDK local message state is the single canonical in-memory text for the
  active stream. Presentation state is never persisted, and displayed
  settled content is exactly canonical content.
- Convex remains the durable, reactive coordination plane: periodic
  snapshots, run lifecycle, settlement receipts, approval recovery, and the
  projection every other surface (reload, second tab, other device) renders.

### Incremental Markdown projection (`lib/markdown/incremental-block-projection.ts`)

Ordinary append-only growth re-parses only the mutable tail from a
blank-line-safe restart boundary (terminal block + one context block held
mutable); identity changes, non-prefix corrections, and parser drift reset
with all-new block identities; settlement runs one authoritative full parse,
verifies equivalence against the incremental result, and freezes every
block. Block identities are monotonic per lineage, so completed blocks never
re-key, re-parse, or re-render during growth. The remark/unified pipeline
stays the single semantic authority; the legacy full splitter remains as the
reference implementation, reset/settlement path, and test oracle. A
25-fixture corpus (streamed char-by-char and at seeded random chunk
boundaries) proves block-for-block equality with the full parser at every
prefix; anomalies (reset/fallback/settle-mismatch) emit content-free marks.

### Lazy Shiki (`lib/markdown/shiki-client.ts`)

No static `shiki` import anywhere in client components. `shiki/core` + the
JavaScript regex engine (no WASM) + the two github themes load behind one
dynamic-import boundary on first demand; grammars load per-language from an
explicit typed allowlist of fine-grained `@shikijs/langs` modules. Unknown
languages render as escaped plain text. No-code conversations ship zero
Shiki bytes. The 300 ms growing-block highlight throttle is unchanged.

### Notification cadence

`CHAT_MESSAGE_THROTTLE_MS = 32` (was 50). With tail-proportional rendering,
measured per-notification commit cost is ~1–3 ms at every accumulated size;
32 ms takes ~3.8% of stream main-thread time on the 100 chunks/s replay
while roughly doubling visible text granularity vs 50 ms. Unthrottled
measured ~11% — viable on fast hardware but without slow-device headroom.
The value is a code constant, not a flag.

### Provider smoothing

`smoothStream()` is not used. It may be introduced only for a specific
provider/model that traces prove emits visually unacceptable bursts after
this client path, and never to conceal renderer slowness.

### Why the second reveal scheduler was rejected

- It created displayed-text state that intentionally trailed canonical text
  — a second quasi-canonical store the invariants above forbid.
- Per-word DOM wrapping across the response added main-thread work exactly
  where the renderer needed to shed it.
- Its adaptive scheduler needed terminal flush paths (Stop/error/approval/
  hidden-tab) that re-implemented settlement concerns in the presentation
  layer.
- After PR B–D, raw deltas at 32 ms paint smoothly; the problem the reveal
  solved no longer exists. A mutable-tail-only CSS fade (plan PR F) remains
  available if a future visual-quality gate fails, but is deliberately
  omitted now.

## Consequences

- Per-update Markdown work is proportional to the mutable tail: 88.6 ms →
  0.23 ms per update on a ~100 KB response (M4 Max harness), removing the
  long-task-per-notification failure class at its root.
- The renderer no longer needs protecting: the throttle is a smoothness/
  batching choice, not a survival mechanism.
- Recovery semantics are unchanged and re-verified: reload, navigation,
  second-tab projection, cross-tab durable Stop, and settlement convergence
  behave identically on the production build.
- New invariants are enforced by CI: the equivalence corpus, the 2× p95
  scaling gate, the long-task canary at every cadence candidate, and the
  stable-block zero-rerender component tests.
