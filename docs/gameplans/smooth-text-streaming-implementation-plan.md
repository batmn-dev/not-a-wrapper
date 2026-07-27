# Smooth text streaming — implementation plan

- Date: 2026-07-27 (planning pass on `darknight/the-black-glove`, HEAD `d3c29bbf` = merged PR #129); revised same day: single-PR structure, formerly-open questions resolved
- Decision record: `docs/adr/0015-presentation-reveal-above-the-message-throttle.md`
- Glossary: **Presentation reveal** in `CONTEXT.md`
- Status: implemented 2026-07-27 — one PR, six commits as specified in §8;
  merge gate passed (`docs/measurements/2026-07-27-presentation-reveal-decision.md`)

## 1. Executive decision

Build a client-side **Presentation reveal**: a word-boundary prefix of the canonical
streamed text, advanced by a rAF-driven adaptive scheduler (assistant-ui's
`interval = min(maxCharIntervalMs, drainMs / backlog)` algorithm), committed to React
at a gated cadence (48–96 ms), with newly revealed words faded in by a CSS opacity
animation applied through a rehype plugin in the growing terminal Markdown block
(Lobe UI's birth-timeline / negative-`animation-delay` technique). Prose and
reasoning participate; code-fence interiors, tools, approvals, sources, errors, and
terminal states appear at canonical cadence. The 50 ms AI SDK throttle and the
750 ms Convex snapshot cadence are both untouched. No feature flag.

Delivery shape: **one PR, six commits** — three inert foundation commits (pure core,
fade renderer, hook), one wiring commit, one measurement/gate commit, one docs
commit. The PR merges only after the measured bounded-cost gate passes on the
existing deterministic stress streams (§9); the whole PR is the rollback boundary.
Reduced-motion users get canonical text with zero reveal structure.

Per-visual-update granularity target: **≤ 1 word** at typical token rates — achieved
by CSS `animation-delay` stagger *within* each commit, not by per-word React commits,
which is how the strict granularity bar coexists with the bounded-cost gate.

## 2. Requirements and constraints from the grill-me interview

All ten answers below are authoritative planning constraints.

1. **Product bar: ChatGPT word-fade parity.** Not merely a steadier cadence — text
   appears word-by-word with a brief fade, matching the app's ChatGPT-fidelity ethos.
2. **Lag budget: adaptive, ~300 ms typical, 1 s hard cap.** Reveal rate adapts to
   backlog; abnormal terminals flush instantly (precise flush table in §7).
3. **Mechanism: commit-gated reveal + fade.** React owns the DOM end-to-end; the
   smoother feeds a growing prefix into the Markdown renderer. The post-Markdown
   DOM-animation alternative (MutationObserver + span wrapping outside React) is
   rejected (§5).
4. **Gate: bounded cost, not commit parity.** Higher commit frequency than the 50 ms
   throttle is acceptable **iff** long main-thread tasks (>50 ms) and dropped frames
   stay at the flags-on baseline on the stress streams, and React Profiler shows
   reveal commits confined to the terminal-block subtree.
5. **Scope: prose + reasoning. Code interiors excluded** (canonical 50 ms cadence
   inside fences, 300 ms Shiki re-highlight kept, no word fade). Tools, approvals,
   sources, errors render immediately, unsmoothed.
6. **Cadences unchanged.** The 50 ms client throttle stays permanent; 32 ms is
   measured as a comparison variant only, never shipped. The 750 ms Convex snapshot
   cadence stays; append-only deltas remain deferred (§10).
7. **No flag.** The reveal ships as permanent behavior; rollback = revert the PR.
   The reduced-motion instant path exists for accessibility, not as a rollout seam.
8. **Sequencing: production build, gate-before-merge.** The real implementation is
   measured against the gate before the PR merges, with numbers committed to
   `docs/measurements/` (the PR2/PR3 pattern). Single-PR delivery keeps this: the
   gate runs on the PR branch after the wiring commit, before merge.
9. **Acceptance: strict granularity.** ≤ 1 word median per visual update at typical
   token rates (30–80 tok/s); plus the criteria in §9.
10. **Documentation: CONTEXT.md term + ADR 0015** — both created in this pass.

### Formerly-open questions — now resolved (decisions, not options)

- **R1 — Tuning point values.** Fixed in §6 as the shipped defaults:
  prose `drainMs 250 / maxCharIntervalMs 5 / maxCharsPerFrame 120 / minCommitMs 48
  widening to 96 / maxLagMs 1000 / settleDrainMs 400`; fade `180 ms,
  cubic-bezier(0.33, 0, 0.67, 1)`, per-word stagger = observed commit gap ÷ new
  words clamped to `[8, 80] ms`, birth cap `now + commitGap + 180`.
  Rationale: `drainMs 250` yields ~250 ms typical lag (inside the 300 ms p50
  budget); `minCommitMs 48` puts reveal commits at ≈ today's 20/s Markdown-subtree
  commit rate, giving the bounded-cost gate margin by construction; the widening
  formula is Lobe UI's proven mitigation for tail-block re-parse cost. The gate
  commit still measures `minCommitMs 32 vs 48` — as a *tuning check with a default
  already chosen*, not an open design question. If 32 passes the cost gate with
  visibly better continuity, flip the constant in the same commit and record it.
- **R2 — Reasoning drains faster than prose.** Yes. Reasoning uses its own profile:
  `drainMs 150 / settleDrainMs 250`, all other values shared. Rationale: reasoning
  streams are long and low-stakes, the activity panel shares the animation budget
  with prose (both can be live simultaneously), and a tighter drain keeps the panel
  from trailing during long thinks. Confirmed against chatgpt.com side-by-side
  during the gate run; if parity clearly disagrees, adjust the constant then.
- **R3 — Follower tabs.** Decided: follower/live provider-fed rows get the **same
  client-side mechanism in a separate later change**, with a follower profile
  (`drainMs ≈ 900`, lag budget ≤ 1.5 s to bridge 750 ms snapshot gaps) and **no
  backend change**. It is explicitly out of this PR: different tuning regime,
  different observation surface, zero shared risk. This PR only records the
  follower-cadence baseline metric (§9) so that change has a before-number.

## 3. Verified current architecture and the exact cause of visible chunking

All paths verified on `darknight/the-black-glove` @ `d3c29bbf` (2026-07-27).
PR [#129](https://github.com/darknightdesigner/not-a-wrapper/pull/129) ("Harden
durable turn continuation recovery") is **merged**, and its merge commit is exactly
this branch's HEAD — the durable presentation, dynamic-tool approval, and
terminal-settlement behavior referenced below is the post-#129 code, inspected
directly, not the PR diff.

### The active-tab pipeline

1. **Transport → canonical state.** `useChat({ chat, throttle: CHAT_MESSAGE_THROTTLE_MS })`
   at [use-chat-core.ts:311](../../app/components/chat/use-chat-core.ts). The
   installed `@ai-sdk/react@4.0.23` mutates `chat.messages` synchronously on every
   wire chunk and throttles only the *messages change-notification* to
   `useSyncExternalStore` (leading + trailing via `throttleit@2.1.0`); status and
   error subscriptions are never throttled
   ([chat.react.ts#L74-L86](https://github.com/vercel/ai/blob/b162ae48676fe9e7b3880b691cbd60b58ed179cb/packages/react/src/chat.react.ts#L74-L86),
   [use-chat.ts#L140-L158](https://github.com/vercel/ai/blob/b162ae48676fe9e7b3880b691cbd60b58ed179cb/packages/react/src/use-chat.ts#L140-L158)).
   Consequence: `messages` is a **lossless but coarsely sampled target signal** —
   the latest state always arrives (trailing call), only intermediate renders are
   skipped. `CHAT_MESSAGE_THROTTLE_MS = 50` is documented as permanent in
   [message-throttle.ts](../../lib/chat-performance/message-throttle.ts).
2. **Render.** `MessageAssistant` → `MessageContent(markdown, streaming)`
   ([message.tsx](../../components/ui/message.tsx) — spreads extra props into
   `Markdown`, so new Markdown props thread through without touching it) →
   [markdown.tsx](../../components/ui/markdown.tsx): `parseMarkdownIntoBlocks`
   (remark parse of the full accumulated string) splits into per-block records;
   `MemoizedMarkdownBlock` re-renders a block only when its `content` or
   `stability` changes; only the terminal block of a live message is `growing`.
3. **Code.** The growing terminal code block re-highlights at most every 300 ms
   ([streaming-code-render.ts](../../lib/chat-performance/streaming-code-render.ts),
   [code-block.tsx](../../components/ui/code-block.tsx) generation-token
   invalidation); settled blocks highlight immediately on the growing→stable flip.
4. **Reasoning.** The live reasoning surface is the Activity panel:
   `ActivityEntryRow` in
   [activity-panel.tsx](../../app/components/chat/activity/activity-panel.tsx)
   (lines ~311–315) renders `entry.detail` through `Markdown` for
   `entry.kind === "reasoning"`; entries carry a stable `id` and
   `status: "running" | "complete"`
   ([assistant-activity.ts](../../lib/chat-messages/assistant-activity.ts)).
   (`components/ui/reasoning.tsx` is consumed only by the `app/test/thinking-states`
   QA page — it is *not* the production reasoning path and is not wired.)
   Reasoning deltas are message *parts*, so they arrive at the 50 ms cadence.
5. **Scroll.** No JS stick-to-bottom; native `overflow-anchor` + scroll-margin
   contract ([thread-scroll.tsx](../../app/components/chat/thread-scroll.tsx),
   `docs/chatgpt-scroll-architecture-audit.md`).
6. **A11y.** [chat-announcer.tsx](../../app/components/chat/chat-announcer.tsx)
   announces via `aria-live` regions fed from canonical state.
7. **Instrumentation seam (exists).**
   [lib/observability/chat-performance.ts](../../lib/observability/chat-performance.ts):
   content-free, allow-listed User Timing marks, enabled at build time by
   `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION === "true"` — the substrate the
   measurement runbook's traces read. The gate commit extends this, it does not
   invent a new system.

### The persistence/follower pipeline

- The **durable turn runtime** ([durable-turn-runtime.ts](../../app/api/chat/durable-turn-runtime.ts),
  `throttleMs = 750` at line ~605) writes cumulative `textSnapshot` + full
  `partsSnapshot` through `updateAssistantSnapshot`
  ([chatRuntime.ts](../../convex/chatRuntime.ts) line ~1626, no-op dedupe when
  content is unchanged), plus one unconditional final full-parts snapshot at
  settlement (ADR-0011). Post-#129, continuation recovery and terminal settlement
  are server-owned; durable turns exclude `req.signal`.
- Follower tabs/devices read via the messages provider
  ([provider.tsx](../../lib/chat-store/messages/provider.tsx) —
  `usePerUserQuery(api.messages.getSelectedConversation)`): **~750 ms jumps of
  sentence-to-paragraph size**.

### Exact cause of active-tab chunkiness — hypothesis verified

The visible lumpiness on the active tab is the 50 ms notification throttle, not the
750 ms Convex cadence: the active tab never renders from Convex during its own
stream (canonical state is the AI SDK messages array; the provider path serves
navigation/reload/followers). At 30–80 tok/s, 50 ms coalesces ~2–8 words into one
commit, and between commits nothing moves — there is no intermediate paint. The
750 ms cadence explains *follower-tab* chunkiness only. Confirmed by reading the
throttle implementation (above) and the render path: no other layer delays or
batches text on the active tab. (The 300 ms Shiki throttle makes *code* appear to
update even more coarsely — but code is excluded from smoothing by decision #5.)

## 4. Relevant open-source findings

Source-inspected (no docs/blogs); permalinks are commit-pinned.

### Vercel AI SDK (`ai@7.0.22`, `@ai-sdk/react@4.0.23` — the installed versions)

- Client: **no presentation smoothing exists**; the only client lever is the render
  throttle described in §3.
- Server: `smoothStream` is an `experimental_transform` on `streamText` that
  re-chunks and *wall-clock-delays* the actual stream inside the transform
  ([smooth-stream.ts](https://github.com/vercel/ai/blob/b162ae48676fe9e7b3880b691cbd60b58ed179cb/packages/ai/src/generate-text/smooth-stream.ts),
  piped upstream of the event processor at
  [stream-text.ts#L1518-L1530](https://github.com/vercel/ai/blob/b162ae48676fe9e7b3880b691cbd60b58ed179cb/packages/ai/src/generate-text/stream-text.ts#L1518-L1530)).
  Everything downstream — wire SSE, `onFinish`, and therefore this repo's durable
  snapshot pacing and abort-time truncation (the transform has no `flush()`; an
  abort drops the unflushed word buffer) — inherits the delay. **Disqualified**:
  smoothing would become a durability property, violating the presentation-only
  invariant.

### assistant-ui (main @ `5e4a2a4`) — the reveal scheduler to copy

[useSmooth.ts](https://github.com/assistant-ui/assistant-ui/blob/5e4a2a440338ce9052e22529342b03e8c268655a/packages/react/src/utils/smooth/useSmooth.ts):
- Adaptive rate with zero tuning state: per-char interval =
  `min(maxCharIntervalMs (5ms), drainMs (250ms) / backlogChars)`, recomputed every
  rAF frame; fractional frame time banked (`lastUpdateTime = now - timeToConsume`);
  a per-frame char cap deliberately does **not** bank surplus (anti-burst).
- `minCommitMs` decouples cursor advance (per frame) from `setState` (per commit);
  the catching-up frame **always commits**.
- Non-prefix changes snap, twice: render-phase resync when
  `!text.startsWith(displayedText)` (running → restart from empty; settled → full
  text instantly) and an effect-side animator reset that also checks **part
  identity** (a new part sharing a prefix must not keep a stale cursor).
- Presented status is overridden to "running" until the reveal catches up — the
  terminal-UI gate is `displayed === target`, not transport status.
- `prefers-reduced-motion` auto-disables, overriding explicit opt-in.
- Weakness we avoid: their whole revealed prefix feeds one non-memoized
  `ReactMarkdown` (full re-parse per commit); our per-block memoization makes each
  commit touch only the terminal block.

### Convex Agent (`@convex-dev/agent@0.6.4` — installed, tag = `2ac7448`)

- [useSmoothText.ts](https://github.com/get-convex/agent/blob/2ac74487d69462b6575e21526e09d52a9371c578/src/react/useSmoothText.ts):
  20 Hz `setInterval` prefix slicer, one-step observed rate + lag-burn-down term,
  EMA-blended with a 2× growth clamp. **No shrink/replacement handling** (monotonic
  cursor; stale text persists on shrink) — inferior to assistant-ui's snap for our
  correction paths; not adopted.
- Delta streaming: `smoothStream({delayInMs: null, chunking})` for granularity only,
  then a `DeltaStreamer` writing **one `addDelta` mutation per ≥250 ms window**,
  each an append-only row of batched chunks addressed by monotonic part-index
  cursors ([streaming.ts#L157-L162](https://github.com/get-convex/agent/blob/2ac74487d69462b6575e21526e09d52a9371c578/src/client/streaming.ts#L157-L162),
  [streams.ts#L37](https://github.com/get-convex/agent/blob/2ac74487d69462b6575e21526e09d52a9371c578/src/component/streams.ts#L37)).
  Clients merge stream-derived and persisted messages deduped by a shared
  `(order, stepOrder)` key; stream rows are GC'd 5 min after finish. This is the
  reference design if delta streaming is ever justified (§10) — and it confirms the
  hypothesis: **Convex Agent's 250 ms is per-stream append-only delta batching, not
  equivalent to retuning our 750 ms cumulative snapshot overwrite.**
- **Compatibility constraint (verified in-repo):** the component is registered
  config-only in [convex.config.ts](../../convex/convex.config.ts) because it peers
  on `ai ^6` while the app runs `ai@7` — nothing app-side may import its JS client
  surface (including `useSmoothText` and the sync/delta client hooks) until an
  ai@7-compatible release ships. Any smoother must be app-owned code.

### Convex Persistent Text Streaming (main @ `588be3c`; not installed)

Append-only `chunks` table, DB write only on sentence delimiters (no time throttle),
follower reads via a reactive query that joins **all** chunks on every update; the
driving client reads the raw HTTP stream. **No smoothing anywhere in the repo**;
never compacts. Confirms: Convex's own patterns accept chunky follower updates —
Convex realtime provides zero presentation smoothing (hypothesis verified from
source, both components).

### Lobe UI (v5.24.0 @ `90ae53d`) — the fade renderer to copy

4-layer pipeline mirroring ours: prefix smoother → per-block lexing → per-block
memoized render → **[rehypeStreamAnimated](https://github.com/lobehub/lobe-ui/blob/90ae53d982bbaf7ba25b316810c8d3f11fee2023/src/Markdown/plugins/rehypeStreamAnimated.ts)**,
a rehype plugin wrapping trailing text units in animated spans. Key mechanics:
- Skip list: never wraps inside `pre/code/table/svg`/KaTeX; word mode uses
  `Intl.Segmenter` (CJK-correct).
- **Birth-timeline runtime**: per-block mutable birth timestamps + write-once
  frozen styles; spans render with negative `animation-delay: -elapsed ms`, so
  re-renders and even remounts *resume* an in-flight fade instead of restarting it
  (the central React hazard: a rewritten style attribute restarts a CSS animation).
- Stagger is paced from the **observed commit gap ÷ new chars** (clamped), so
  per-word flow looks continuous across variable commit intervals; a birth cap
  (`now + gap + fadeDuration`) prevents fades scheduled seconds into the future.
- Commit throttle *below* frame rate (48–96 ms, widening with tail-block length) —
  "committing at 60–120fps burns CPU without visible benefit — the per-char stagger
  inside a commit is carried by animation-delay" (their comment).
- **Settle = wrapper removal**: once a block is revealed and its last fade elapsed,
  the animation plugin is dropped from that block's plugin list → the memoized
  block re-renders exactly once as plain text, zero spans retained.
- Escape hatches to instant sync: non-append-only change, very large appends, open
  fences for iframe-rendered languages.
- Fade: opacity 0→1, 180 ms, `fill-mode: forwards`. Reduced motion: **not handled**
  (we will).

### Open WebUI (v0.11.0 @ `01f4282`) — the cautionary baseline

Per-word fade by naive `split(' ')` over **every** text token of the streaming
message ([TextToken.svelte](https://github.com/open-webui/open-webui/blob/01f4282f1ffe0d6212f58d3afbeae21fffd0c4be/src/lib/components/chat/Messages/Markdown/MarkdownInlineTokens/TextToken.svelte#L1-L16),
100 ms fade in [app.css#L244-L256](https://github.com/open-webui/open-webui/blob/01f4282f1ffe0d6212f58d3afbeae21fffd0c4be/src/app.css#L244-L256)):
unbounded span count during the stream, whole-message unwrap at `done`, no stagger,
no CJK segmentation, no reduced motion. Their rAF batching (message-list rebuild
and markdown lexing coalesced to once per frame) validates rAF-gating computation,
and their terminal path bypasses rAF (synchronous parse on `done`) — the
hidden-tab-safety pattern every surveyed implementation converges on: **final state
must never depend on animation frames**.

### Cross-cutting verified hypotheses

- Transport updates ≠ React renders ≠ paints: the AI SDK throttle gates renders,
  not content; CSS stagger gates perceived paints, not renders. The plan exploits
  all three layers separately.
- Character-level staggering cost: Lobe UI's own source comment calls word-over-char
  "the main CPU lever (~5× fewer nodes)"; char mode remains their non-default.
  Word granularity confirmed as the right choice.
- Reveal-fed segmentation: block splitting must run on the **revealed** text (an
  unrevealed fence closer would otherwise flicker block boundaries) — encoded in
  §6.

## 5. Chosen approach and rejected alternatives

**Chosen: commit-gated adaptive prefix reveal (assistant-ui scheduler) + rehype
word-fade in the growing block (Lobe UI renderer), composed with this repo's
existing per-block memoization.** The two systems compose precisely because a
growing prefix only ever changes the terminal block boundary, and our
`MemoizedMarkdownBlock` already isolates that subtree; the settle unwrap rides the
existing `growing → stable` flip.

Rejected:

1. **Throttle retune (50 → 32 ms) as the fix** — still lumps 1–5 words per commit
   with dead time between commits; raises exactly the reconciliation cost the
   throttle bounds. Kept only as a measurement variant (§9).
2. **Post-Markdown DOM animation** (MutationObserver + span wrapping outside React)
   — zero extra commits but a second DOM writer racing React reconciliation,
   Shiki's async `innerHTML` replacement, KaTeX/links, and per-block memo bailouts;
   stale-wrapper cleanup on branch switch/regeneration/non-prefix correction is
   manual. Interview decision #3.
3. **Server-side `smoothStream`** — contaminates persistence and abort behavior
   (§4); violates "smoothing affects presentation only".
4. **Convex Agent client (`useSmoothText` / delta hooks)** — blocked by the ai@7
   peer constraint (config-only registration); algorithm inferior on shrink/reset
   anyway.
5. **Character-level reveal/fade** — ~5× animated-node and event cost for
   sub-word polish ChatGPT parity doesn't require.
6. **Store-level char-drain smoothing** (lobe-chat's `fetchSSE` queue) — redundant
   below a renderer-level smoother; adds a second stateful layer between transport
   and canonical state, which the invariants forbid.

## 6. Implementation design — modules, signatures, and exact wiring

All names verified free of collisions. TypeScript signatures below are the intended
public seams; internals may vary, seams may not (they are what the tests pin).

### 6.1 `lib/chat-performance/presentation-reveal.ts` — pure core (no React, no timers)

```ts
export type RevealProfile = {
  drainMs: number            // target time to drain any backlog
  maxCharIntervalMs: number  // slowest per-char interval (rate floor cap)
  maxCharsPerFrame: number   // anti-jank per-tick ceiling
  minCommitMs: number        // narrowest commit interval
  maxCommitMs: number        // widest commit interval (tail-scaled)
  commitWidenChars: number   // tail chars that double the commit interval
  maxLagMs: number           // hard display-lag cap; excess is snapped
  settleDrainMs: number      // drain window after natural completion
}
export const PROSE_REVEAL_PROFILE: RevealProfile = {
  drainMs: 250, maxCharIntervalMs: 5, maxCharsPerFrame: 120,
  minCommitMs: 48, maxCommitMs: 96, commitWidenChars: 2048,
  maxLagMs: 1000, settleDrainMs: 400,
}
export const REASONING_REVEAL_PROFILE: RevealProfile = {
  ...PROSE_REVEAL_PROFILE, drainMs: 150, settleDrainMs: 250,
}

export type RevealPhase = "streaming" | "settling"
export type RevealState = {
  frontier: number        // raw char frontier into canonical text
  displayedEnd: number    // frontier clamped to word/fence boundary (what renders)
  lastTickMs: number
  carryMs: number         // banked fractional time (assistant-ui pattern)
  lastCommitMs: number
}

export function createRevealState(canonical: string, live: boolean): RevealState
// live=false → frontier = displayedEnd = canonical.length (history never animates)

export function advanceReveal(
  state: RevealState, canonical: string, nowMs: number,
  profile: RevealProfile, phase: RevealPhase,
): { state: RevealState; shouldCommit: boolean; caughtUp: boolean }

export function reconcileCanonical(
  state: RevealState, nextCanonical: string, identityChanged: boolean,
): { state: RevealState; discontinuity: "none" | "snap" }
```

Specified behavior (each bullet is a unit test):

- **Rate math** (`advanceReveal`, phase `"streaming"`): per-char interval =
  `min(maxCharIntervalMs, drainMs / backlog)`; chars consumed =
  `floor(elapsed / interval)` capped at `maxCharsPerFrame`; fractional remainder
  banked in `carryMs`, EXCEPT when the per-frame cap was hit (surplus discarded —
  the assistant-ui anti-burst rule). First advance after text becomes non-empty
  always reveals ≥ the first word and reports `shouldCommit: true` (leading edge —
  first text is never delayed).
- **Hard lag cap**: if `(canonical.length − frontier)` exceeds what the max drain
  rate (`maxCharsPerFrame` per 16.7 ms frame) clears in `maxLagMs`, jump `frontier`
  forward so projected lag = `maxLagMs`. The jumped-over text renders as
  already-revealed (no fade births for it).
- **Settling** (phase `"settling"`): recompute interval as
  `min(maxCharIntervalMs, settleDrainMs / backlog)` — the tail types out within
  the settle window; the tick that reaches `caughtUp` always reports
  `shouldCommit: true`.
- **Commit gate**: `shouldCommit` iff `nowMs − lastCommitMs ≥ commitInterval`,
  where `commitInterval = min(maxCommitMs, minCommitMs × (1 + tailBlockChars /
  commitWidenChars))` and `tailBlockChars` = chars since the last committed
  double-newline boundary (cheap proxy for terminal-block length; exact block
  membership is not needed here).
- **Word clamping** (`displayedEnd`): segment only the window
  `[previous displayedEnd, frontier + 40]` with a cached
  `Intl.Segmenter(undefined, { granularity: "word" })` — never the whole string —
  and clamp to the last boundary ≤ frontier. A boundary is never emitted mid-word,
  so fade spans get stable final text (no mid-fade text patching).
- **Fence fast-forward**: maintain fence spans incrementally — on each
  `reconcileCanonical`, scan only the appended slice line-by-line for
  `^ {0,3}(```|~~~)` openers/closers (tracking indented/nested state), extending a
  cached span list. If `displayedEnd` lands inside an open fence span, advance it
  to `min(canonical.length, fenceContentEnd)` — code interiors reveal at canonical
  cadence (decision #5), prose after a closed fence resumes word reveal. Fixture
  cases: fence at message start, fence after prose, unterminated fence at stream
  end, `~~~` fences, indented (4-space) non-fence code, fence inside blockquote.
- **Snap rules** (`reconcileCanonical`): `identityChanged` OR
  `!nextCanonical.startsWith(prefix already displayed)` → `discontinuity: "snap"`,
  state reset to `createRevealState(nextCanonical, live)`. Append-only growth →
  `"none"`, spans list extended.

### 6.2 `lib/markdown/rehype-stream-fade.ts` — fade plugin + birth runtime

```ts
export type StreamFadeRuntime = ReturnType<typeof createStreamFadeRuntime>
export function createStreamFadeRuntime(): {
  noteCommit(blockKey: string, revealedWordCount: number, nowMs: number): void
  styleFor(blockKey: string, wordIndex: number, nowMs: number): // frozen result
    { className: "stream-word" | "stream-word stream-word-revealed"
      style?: { animationDelay: string } }
  prune(liveBlockKey: string | null): void
}
export function rehypeStreamFade(options: {
  runtime: StreamFadeRuntime
  blockKey: string
}): (tree: HastRoot) => void
```

Specified behavior:

- The plugin walks the hast tree of ONE block; wraps word segments
  (`Intl.Segmenter`, CJK-correct) of text nodes in `<span>` using
  `runtime.styleFor(blockKey, runningWordIndex)`. Whitespace segments stay plain
  text nodes (selection/copy fidelity). Skip list: never descend into
  `pre`, `code`, `table`, `svg`, or any element with a KaTeX class.
- Birth assignment (in `noteCommit`, called once per commit before render): new
  words beyond the previous count get monotonically chained births
  `birth[i] = min(cap, max(prevBirth + pace, now))` with
  `pace = clamp(observedCommitGap / newWords, 8, 80) ms` and
  `cap = now + observedCommitGap + 180`.
- `styleFor` freezes its result per `(blockKey, wordIndex)` on first computation
  (write-once cache): elapsed ≥ 180 ms → the `stream-word-revealed` class with no
  style; else `animation-delay: -${elapsed}ms`. Frozen results keep span props
  referentially stable across re-renders — React never rewrites `animation-delay`
  on an in-flight fade (rewrite = restart, the central hazard), and negative delay
  makes even a remounted span resume mid-fade.
- Idempotent under double render (StrictMode): `noteCommit` with an unchanged
  `(blockKey, revealedWordCount)` is a no-op; `styleFor` reads the cache.
- `prune(liveBlockKey)` drops runtimes for any other block (called when the
  terminal block index advances or the message resets).

CSS (append to [app/globals.css](../../app/globals.css), plain CSS — not Tailwind
utilities, per the known `motion-reduce` cascade gotcha):

```css
@keyframes stream-word-fade { from { opacity: 0 } to { opacity: 1 } }
.stream-word { animation: stream-word-fade 180ms cubic-bezier(0.33, 0, 0.67, 1) both; }
.stream-word-revealed { animation: none; }
@media (prefers-reduced-motion: reduce) { .stream-word { animation: none; } }
.stream-word .katex * { animation: none !important; }
```

### 6.3 [markdown.tsx](../../components/ui/markdown.tsx) — threading (≤ 15 lines)

- `MarkdownProps` gains `fadeRuntime?: StreamFadeRuntime`.
- In `MarkdownComponent`, the growing terminal block (the existing
  `streaming && index === blocks.length - 1` branch) computes
  `rehypePlugins = [rehypeKatex, [rehypeStreamFade, { runtime, blockKey }]]`
  with `blockKey = block.id`; all other blocks keep the current list. Plugin array
  identity must be stable per (runtime, blockKey) via `useMemo` — an unstable
  array would defeat `MemoizedMarkdownBlock`'s bailout for settled blocks.
- `MemoizedMarkdownBlock.propsAreEqual` already re-renders on the
  `growing → stable` flip; because the stable branch passes no fade plugin, that
  one re-render **is** the wrapper-removal commit (Lobe UI's settle pattern, for
  free). No comparator change needed unless the plugin array is threaded as a prop
  — thread `stability` + `fadeRuntime` instead and derive the array inside the
  block component to keep the comparator two-field.
- `MessageContent` ([message.tsx](../../components/ui/message.tsx)) already spreads
  `Omit<ComponentProps<typeof Markdown>, "children">` — `fadeRuntime` flows through
  with zero changes there.

### 6.4 `app/components/chat/use-presentation-reveal.ts` — React binding

```ts
export function usePresentationReveal(args: {
  text: string                 // canonical (throttled) text
  live: boolean                // transport liveness (submitted/streaming)
  settleMode: "drain" | "immediate"  // how to finish when live flips false
  revealKey: string            // messageId or reasoning entry id
  profile: RevealProfile
}): { text: string; caughtUp: boolean; fadeRuntime: StreamFadeRuntime }
```

Specified behavior:

- State in refs (core `RevealState` + fade runtime, keyed by `revealKey`;
  `revealKey` change = full reset via `createRevealState(text, live)`).
  One `useState<string>` holds the displayed text — the only render trigger.
- rAF loop: self-stopping (id nulled when `caughtUp`), idempotent start on each
  canonical growth (resets the tick clock so idle time isn't consumed), cancelled
  on unmount. Each frame: `advanceReveal`; on `shouldCommit`,
  `fadeRuntime.noteCommit` then `setDisplayed`.
- **Terminal handling is effect-driven, never rAF-driven**: when `live` flips
  false — `settleMode === "immediate"` → synchronous snap to canonical (single
  commit, no births, runtime pruned); `"drain"` → phase `"settling"` until caught
  up (rAF), but with a `setTimeout(settleDrainMs + 100)` backstop that force-snaps
  if frames never run (hidden tab).
- **Hidden tab**: if `document.visibilityState === "hidden"` at any canonical
  update or when `live` flips, snap displayed = canonical immediately (no
  animation, no queued fades); a `visibilitychange` listener re-arms normal reveal
  for text that arrives after the tab is visible again.
- **Reduced motion**: `matchMedia("(prefers-reduced-motion: reduce)")` (subscribed
  via `useSyncExternalStore` so toggling live updates) short-circuits the whole
  hook: returns `{ text, caughtUp: true, fadeRuntime: NOOP_RUNTIME }` — no rAF, no
  state, no spans (the CSS rule is defense-in-depth, not the mechanism).
- Non-live input (`live: false` from mount, i.e. history): displayed = canonical,
  no machinery engaged.

### 6.5 [message-assistant.tsx](../../app/components/chat/message-assistant.tsx) — prose wiring

Exact edits (referencing current line numbers):

- Derive once near the top:
  ```ts
  const transportLive = status === "submitted" || status === "streaming"
  const settleMode =
    status === "aborted" || status === "failed" || status === "awaiting_approval"
      ? "immediate" : "drain"
  const reveal = usePresentationReveal({
    text: children, live: transportLive && Boolean(isLast),
    settleMode, revealKey: messageId, profile: PROSE_REVEAL_PROFILE,
  })
  const presentedLive = (transportLive || !reveal.caughtUp) && Boolean(isLast)
  ```
- `contentNullOrEmpty` (line 79) and the `MessageContent` child (line 235) switch
  from `children` to `reveal.text` (leading-edge commit guarantees no
  empty-body flash on first token).
- `MessageContent` (line 226): `streaming={presentedLive}` (was
  `status === "submitted" || status === "streaming"`) and
  `fadeRuntime={reveal.fadeRuntime}` — keeps the terminal block `growing` (fade
  wrappers + growing-code classification) until the reveal drains, then the flip
  to `stable` removes wrappers and triggers the final Shiki pass.
- Caret: `showActiveContentCaret` (line 158) uses `presentedLive` instead of
  `status === "streaming"`; the `fading` transition condition (line 174) replaces
  `status === "ready"` with `status === "ready" && reveal.caughtUp` so the caret
  outlives the transport by exactly the drain, matching ChatGPT.
- Footer: `isLastStreaming` (line 80) becomes `presentedLive`-based so actions
  reveal after the drain, not mid-fade.
- Rows that are not the live last row pass `live: false` — the hook is inert and
  the render output is byte-identical to today's.

### 6.6 [activity-panel.tsx](../../app/components/chat/activity/activity-panel.tsx) — reasoning wiring

- In `ActivityEntryRow` (line ~292), reasoning entries
  (`entry.kind === "reasoning"`) route `entry.detail` through
  `usePresentationReveal({ text: entry.detail, live: entry.status === "running",
  settleMode: "drain", revealKey: entry.id, profile: REASONING_REVEAL_PROFILE })`
  and render `Markdown` with `streaming={entry.status === "running" || !caughtUp}`
  + `fadeRuntime`. Hooks must be unconditional — extract a
  `ReasoningEntryDetail` child component so the hook only mounts for reasoning
  rows.
- Step-splitting already happens upstream in `assistant-activity.ts` on canonical
  text; the reveal applies to each step's `detail` string independently, keyed by
  the stable entry id — a step that stops growing (a later step appeared) has
  `status: "complete"` and drains.

### Explicitly untouched

`lib/chat-performance/message-throttle.ts`,
`lib/chat-performance/streaming-code-render.ts`, `code-block.tsx`,
`components/ui/reasoning.tsx` (test-page-only consumer), the durable turn runtime,
all Convex modules, the messages provider, `thread-scroll.tsx`,
`chat-announcer.tsx` (announcer keeps reading canonical state).

## 7. Behavior matrix

| Content / event | Behavior |
|---|---|
| Prose (terminal growing block) | Word-boundary reveal + fade; ≤1 word per visual step via stagger |
| Markdown structure (lists, headings, links, tables) | Revealed text feeds the splitter, so structure appears as its source words reveal; table/KaTeX interiors render unfaded (skip list) |
| Code fences | Frontier fast-forwards through fence content → canonical 50 ms cadence inside fences; Shiki keeps its 300 ms growing throttle; no fade spans inside `pre/code` |
| Reasoning | Same reveal + fade per activity entry (`REASONING_REVEAL_PROFILE`, 150 ms drain) |
| Tools / dynamic tools / approvals / sources | Message parts render immediately at canonical cadence — the reveal wraps only text strings; status/error subscriptions are unthrottled upstream |
| Approval pause (`awaiting_approval`) | `settleMode: "immediate"` → instant flush (approval banner sits under complete text) |
| Stop / abort / failure | `settleMode: "immediate"` → instant flush + immediate terminal UI; stubs unaffected (no text) |
| Natural completion (`ready`) | `settleMode: "drain"`: settle phase drains within 400 ms (250 ms reasoning), final frame always commits; caret and footer settle on `caughtUp` |
| Branch switch / regeneration / edit | `revealKey` (message id / entry id) change → full reset; a live new message reveals from empty, history renders canonical instantly |
| Non-prefix correction / shrinkage (snapshot adoption, continuation tail, replay) | `reconcileCanonical` → snap, runtime pruned — stale text is unrepresentable because displayed is always a prefix-or-equal of canonical |
| Hidden tab | Snap-to-canonical on every update while hidden (event-driven, zero rAF dependency); `visibilitychange` re-arms reveal for post-visibility text; settle backstop timer guarantees terminal convergence |
| Reduced motion | Hook short-circuits: canonical text, no rAF, no spans, no plugin — zero structural overhead |
| Selection / copy | Spans exist only in the growing block, removed on settle; whitespace stays plain text; Copy Response copies canonical message text (not DOM) |
| Announcer | `aria-live` regions keep reading canonical state |
| Autoscroll | Unchanged native-anchor contract; finer reveal produces smaller layout increments (measured); fades are opacity-only |

## 8. Delivery: one PR, six commits

Branch: current working branch (no new branches unless explicitly requested). The
**whole PR is the rollback boundary** (revert restores today's behavior exactly);
commits 1–3 are individually inert (nothing consumes them), so a mid-review
retreat is "drop commits 4–6", not surgery. Each commit compiles, lints,
typechecks, and passes `bun run test` on its own.

**Commit 1 — `reveal: pure presentation-reveal core`**
Files: `lib/chat-performance/presentation-reveal.ts`,
`lib/chat-performance/presentation-reveal.test.ts`,
`benchmarks/chat-performance/reveal.bench.ts`.
Tests (lean — the risky logic only, per repo testing posture): rate math including
carry banking and the no-bank-on-cap rule; leading-edge first-word commit; hard-lag
snap; settle-phase drain; commit-interval widening; word-boundary clamp on the
segmenter window (ASCII + CJK case); the six fence fixtures from §6.1; snap rules
(identity change, non-prefix, shrink). Bench: `advanceReveal` over the
`mixed-markdown` script's growth states (cost must be O(appended), not O(message)).
Done-criteria: tests green; bench committed; zero imports from React.

**Commit 2 — `reveal: rehype word-fade renderer (inert)`**
Files: `lib/markdown/rehype-stream-fade.ts` + test, `app/globals.css` (CSS block
from §6.2), `components/ui/markdown.tsx` (threading per §6.3),
`components/ui/markdown.streaming.test.tsx` (extended — preload the dynamic
markdown import, the known test gotcha).
Tests: wrapper placement (words wrapped, whitespace plain, `pre/code/table`/KaTeX
skipped); frozen-style referential stability across three consecutive renders of a
growing block (the animation-restart hazard — assert the same style object
identity per word); negative-delay values for mid-fade words; `noteCommit`
idempotence (StrictMode double render); settle unwrap (block re-rendered with
`stability: "stable"` contains zero `.stream-word` spans); settled-block DOM
byte-identical to today's output when no `fadeRuntime` is passed.
Done-criteria: no production caller yet — `Markdown` without `fadeRuntime` renders
exactly as before (snapshot-compared in the test).

**Commit 3 — `reveal: usePresentationReveal hook (inert)`**
Files: `app/components/chat/use-presentation-reveal.ts` + test (jsdom, fake
timers + mocked rAF).
Tests: rAF loop self-stops on catch-up and restarts on growth; commit gating;
`settleMode: "immediate"` synchronous snap; `"drain"` with the hidden-tab
setTimeout backstop; visibility-hidden snap path; reduced-motion short-circuit
(zero rAF calls, `NOOP_RUNTIME`); `revealKey` change reset; `live: false` inertness.
Done-criteria: hook untested against real components yet; no caller.

**Commit 4 — `reveal: wire prose + reasoning`**
Files: `app/components/chat/message-assistant.tsx` (exact edits in §6.5),
`app/components/chat/activity/activity-panel.tsx` (§6.6, incl. the
`ReasoningEntryDetail` extraction), test updates in
`message-assistant.test.tsx` / `activity-panel.test.tsx`.
Tests: presented-liveness (caret/footer/`streaming` prop) keyed on
`caughtUp`-aware liveness; abnormal terminals render full text in the same commit
as the terminal banner; non-last and settled rows byte-identical to before wiring
(reveal inert); reasoning entry uses the reasoning profile and drains on
`complete`.
Done-criteria: `bun run typecheck && bun run lint && bun run test` green; manual
dev-server smoke (GPT-5 Mini, never Opus) shows word-fade on prose, raw 50 ms
code streaming inside fences, instant approval/stop rendering.

**Commit 5 — `reveal: instrumentation + gate measurements`**
Files: `lib/observability/chat-performance-client.ts` (new allow-listed,
content-free events: `reveal_commit` {revealedChars, backlogChars},
`reveal_caught_up` {drainMs}, `reveal_snap` {reason enum} — behind the existing
`NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION` build-time flag, same field-allow-list
discipline), measurement additions to `benchmarks/chat-performance/`,
`docs/measurements/2026-XX-XX-presentation-reveal-decision.md` (the gate artifact,
PR description must link it).
Gate procedure (exact): production build (`NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION=true
bun run build:next`), replay the deterministic scripts (`mixed-markdown@30`,
`code-block`, prose@100 chunks/s) per `docs/measurements/chat-performance-runbook.md`;
collect the §9 metric table for the four variants (baseline 50 ms, 32 ms throttle,
fade-only-at-50 ms, full reveal at `minCommitMs` 32 and 48); Chrome DevTools
Performance traces read the User Timing marks; longtask counts via
`PerformanceObserver`; span/animation counts via the §9 DOM probes. Tuning
adjustments (R1's 32-vs-48 check, R2's reasoning-drain eyeball vs chatgpt.com)
land in this commit as constant changes with the numbers recorded.
Done-criteria: every §9 acceptance criterion has a measured value in the decision
doc; all pass, or the fallback ladder is applied and re-measured: (1) widen
`minCommitMs`/`maxCommitMs`; (2) fade-only at 50 ms cadence (spans without extra
commits); (3) **do not merge** — the PR stops, plan revisited. The gate artifact
is what prevents the implementation from silently shipping unmeasured.

**Commit 6 — `docs: accept ADR 0015, update CONTEXT status`**
Files: ADR 0015 `proposed → accepted` (with the decision-doc link), CONTEXT.md
**Presentation reveal** `_Status_` → implemented, this gameplan's status header.

## 9. Tests, benchmarks, instrumentation, acceptance criteria

### Measurement methodology (exact)

Harness: the deterministic stream scripts in
[benchmarks/chat-performance/fixtures.ts](../../benchmarks/chat-performance/fixtures.ts)
(`mixed-markdown @ 30 chunks/s`, `code-block`, plus a `100 chunks/s` prose stress
variant), replayed against a production build, driven per
`docs/measurements/chat-performance-runbook.md`. Instrumentation is the existing
content-free chat-perf marks seam (§3.7) extended in commit 5 — no new system, no
shipped-by-default overhead (build-time flag off in production deploys). Live
smokes use GPT-5 Mini.

| Metric | Method |
|---|---|
| Time to first visible text | `reveal_commit` first mark vs first canonical text mark; delta vs baseline |
| Visible update gaps / words per visual update | MutationObserver probe on the growing block (timestamp + added-text length per DOM change); `animationstart` timestamps per span for stagger-level granularity |
| Canonical→displayed lag | `reveal_commit` backlogChars ÷ measured arrival rate; p50/p95/max |
| Backlog drain time | transport-finish mark → `reveal_caught_up` |
| React commits in message/Markdown subtree | `<Profiler>` around `Conversation` in the measurement build; assert reveal commits render only the terminal-block subtree |
| Markdown parse count/duration | counter + `performance.now()` around `parseMarkdownIntoBlocks` (measurement build) |
| Shiki work / code cadence | existing generation-token counter in `code-block.tsx`; assert 300 ms interval on the code script |
| Long main-thread tasks | `PerformanceObserver({type:"longtask"})`: count + total ms > 50 ms |
| DOM node / active animation counts | periodic `document.querySelectorAll(".stream-word").length` + `document.getAnimations().length`; assert bounded by (words born in last 180 ms + unsettled tail), independent of message length |
| Autoscroll movement / interruption | `scrollTop` deltas per frame during replay; user-scroll interruption per runbook |
| Selection stability | scripted selection across the growing block, asserted across N commits; manual feel check |
| Final byte/part equivalence | after settle: displayed DOM text === canonical text; deep-equal parts vs a no-reveal control |
| Tool/approval visibility latency | part-arrival mark → DOM presence (must equal baseline) |
| Stop/terminal latency | Stop click → terminal UI commit (must equal baseline) |
| Hidden-tab catch-up | hide mid-stream (CDP `Page.setWebLifecycleState`), reveal window end: displayed == canonical within one throttle tick, zero queued animations |
| Convex: mutation count / bytes / invalidations / OCC | `updateAssistantSnapshot` count + `payloadBytes` from server logs; Convex dashboard stats — asserted **unchanged** (client-only change) |
| Follower-tab latency/cadence | two-tab session: snapshot write → follower DOM update; recorded as R3's baseline, no target this round |

### Compared variants

1. Current 50 ms baseline (control).
2. 32 ms throttle (proves the reveal beats retuning; never ships).
3. Fade-only at 50 ms cadence (commit 2 machinery without the reveal — isolates
   fade value; also the gate's fallback #2).
4. Full reveal + fade at `minCommitMs` 32 and 48.

### Acceptance criteria (the merge gate, evaluated in commit 5)

**Smoothness:** median ≤ 1 word per visual update and p95 visible gap ≤ 100 ms
while backlog exists, on the 30 chunks/s prose script.
**Latency:** time-to-first-visible-text within noise of baseline;
canonical→displayed lag ≤ 300 ms p50, ≤ 1 s max; backlog drained ≤ 500 ms after
finish (≤ 400 ms target, 500 hard); Stop/error/approval/tool visibility latency ==
baseline.
**Cost:** long tasks (count and total ms) ≤ baseline + noise on both stress
scripts; no dropped-frame regression; reveal commits confined to the
terminal-block subtree; `.stream-word` count bounded per the DOM metric; Convex
metrics unchanged.
**Correctness:** final byte/part equivalence; hidden-tab catch-up; reduced-motion
run shows zero spans/animations/rAF; selection survives streaming.

## 10. Convex synchronization strategy

- **What Convex synchronizes during generation (verified):** 750 ms-throttled
  cumulative `textSnapshot` + full `partsSnapshot` per run
  (`updateAssistantSnapshot`, no-op-deduped), immediate run-status transitions,
  approval requests/resolutions, and the unconditional final full-parts snapshot at
  settlement (ADR-0011/0009, post-#129).
- **Canonical during an active local stream:** the AI SDK client state on the
  originating tab (hypothesis confirmed — the originating tab retains the HTTP
  stream; Convex is recovery/follower/navigation truth). The paths cannot
  duplicate content: the active tab renders provider data only when the local
  binding is absent, adoption is guarded by the selected-path/run-id seams, and the
  reveal displays a prefix of whichever canonical source feeds the row.
- **Other tabs/devices:** reactive `getSelectedConversation` reads of the snapshot
  writes — ~750 ms jumps, plus immediate status projection.
- **Why 750 ms stays:** no measured follower-tab product requirement; halving the
  interval doubles mutation count/bytes for a surface with no defined bar (commit
  5 asserts write costs untouched). R3's follower smoothing needs no backend
  change — the same separation that makes the active-tab fix presentation-only.
- **Evidence that would justify append-only deltas:** a real follower/multi-device
  requirement (e.g. "follower text within ≤300 ms of the driver") that client-side
  smoothing over 750 ms snapshots cannot fake; or measured snapshot write cost
  (cumulative snapshots are O(message) per write) becoming material at scale.
- **How a future delta protocol avoids duplication:** the Convex Agent shape —
  append-only delta rows keyed by monotonic cursors, deduped against persisted
  messages by a shared ordinal key, stream rows GC'd after finish (§4). It would
  slot **inside** the durable runtime's existing snapshot-tracker seam (same
  writer, new wire format), with the ADR-0011 final full-parts snapshot remaining
  the compaction step: final canonical messages are the persisted rows; transient
  delta rows are tombstoned/GC'd after settlement — one source of truth for replay
  and continuation recovery.
- **Compatibility:** `@convex-dev/agent@0.6.4` is config-only under `ai@7` (peer
  `ai ^6`); adopting its delta client requires an ai@7-compatible release or an
  app-owned reimplementation. Documented blocker for that future work, not for
  this plan.

## 11. Risks, non-goals, resolved-question record

**Risks**
1. *Reveal-commit cost surprises* — commits above 50 ms cadence re-run the full
   `parseMarkdownIntoBlocks` split (O(message)) even though only the terminal
   block re-renders. Mitigated: tail-scaled commit widening (48→96 ms) ships by
   default; measured directly; gate blocks merge otherwise.
2. *Animation restarts on re-render* — mitigated by frozen styles +
   negative-delay resume; commit 2's referential-stability test targets exactly
   this.
3. *Status-vs-reveal races* — status is unthrottled, so terminal status can arrive
   with backlog pending; every terminal path is effect-driven flush/drain with a
   timer backstop (§6.4), and `presentedLive` gates presentation liveness. Tested
   per terminal kind in commit 4.
4. *Fence fast-forward edge cases* — pure-function territory; the six fixtures in
   commit 1 pin them.
5. *Two text sources during handoffs* (local stream ↔ provider adoption on
   reload/branch) — the snap rule (identity + prefix check) makes any handoff a
   reset-to-canonical, never an animation of stale text.
6. *Settle-delayed Shiki* — terminal-block settle (and its final highlight) now
   waits for `caughtUp` (≤ 400 ms after finish). Accepted; noted so nobody "fixes"
   it back.
7. *Hook-order hazard in ActivityEntryRow* — reasoning reveal must live in an
   extracted child component (§6.6) or conditional hooks break; encoded in the
   commit 4 spec.

**Non-goals**
- No transport, wire-format, or persistence change; no Convex schema or cadence
  change; no `smoothStream`; no user-facing smoothing setting; no character-level
  mode; no smoothing of code, tools, or panel chrome; no follower-tab wiring in
  this PR (R3); no new Convex streaming protocol absent the §10 evidence bar.

**Resolved-question record** (was "unresolved" in the first revision)
- R1 tuning values → fixed defaults + a bounded 32-vs-48 check inside commit 5.
- R2 reasoning drain → yes, 150 ms profile, eyeball-confirmed in commit 5.
- R3 follower tabs → same mechanism, separate later change, no backend work;
  baseline metric recorded now.
Nothing remains open that blocks implementation.
