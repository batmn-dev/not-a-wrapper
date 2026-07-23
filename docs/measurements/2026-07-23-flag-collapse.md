# Chat-perf flag collapse — PR 2/3 behavior made permanent (2026-07-23)

Decision record. Pre-launch, with both improvements verified end-to-end
(`2026-07-23-pr2-pr3-verification.md`,
`2026-07-23-perf-followup-measurements.md`,
`2026-07-23-section6-freeze-rootcause.md`), the PR 2/PR 3 feature flags were
removed and the winning behavior made unconditional. Rationale: a flag earns
its keep under uncertainty; after verification it is a second (and here a
third) code path maintained forever, and both retired paths were known-bad —
`legacy` froze/crashed tabs on large code streams, `plain-while-growing`
lost the variant bake-off, and the mode-only configuration (highlight
throttle without the message throttle) froze like legacy. Rollback of any of
this is `git revert`, which is exactly as fast as the old env-var path
(both were a redeploy — the seam was build-time-inlined).

## What changed

- `NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE` **removed**. The throttle is the
  constant `CHAT_MESSAGE_THROTTLE_MS = 50`
  (`lib/chat-performance/message-throttle.ts`), passed directly to
  `useChat`. The resolver, its tests, and the `next.config.ts` default
  injection are deleted. There is deliberately no off switch: 0 ms reproduced
  the unthrottled main-thread saturation.
- `NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE` **removed**. Throttled
  highlighting (≤1 highlight per `GROWING_HIGHLIGHT_THROTTLE_MS` for the
  growing terminal block; immediate for stable/settled blocks) is the sole
  render path in `components/ui/code-block.tsx`. The `legacy` and
  `plain-while-growing` branches, the mode resolver, and
  `GROWING_HIGHLIGHT_DEBOUNCE_MS` are deleted.
- The `next.config.ts` `env` injection block is deleted (nothing left to
  inject).
- Tests: the seam suite keeps the full 0/32/50/100 ms SDK-coalescing matrix
  by mocking the constant (the SDK's throttle semantics remain pinned across
  values); the code-block/markdown streaming suites now assert the single
  path's contracts (bounded highlights, generation-token invalidation,
  XSS-inert plain fallback, settle/theme/unmount, terminal-block stability).
  The resolver unit tests are deleted with the resolvers.

## Round 2 (same day): three more verified levers collapsed

- **`CHAT_SINGLE_PASS_BRANCH_CONTEXT` (PR 1) removed** — and it defaulted
  OFF, so the verified single-pass branch context (~85 ms → ~0.4 ms at 1,150
  rows, hash-identical output across all fixtures + 200 randomized trees) was
  dormant in any deployment that never set it. The shared context is now
  unconditional in `convex/messages.ts`, `convex/chatRuntime.ts`, and the
  branch writer's per-array-version memo; `convex/lib/runtime_flags.ts` and
  the operator shadow query `convex/branchContextShadow.ts` (which would now
  compare a path against itself) are deleted. The writer-equivalence property
  test still pins the shared-context writer against the pre-PR-1 fixture
  oracle.
- **`ENABLE_PAGINATED_SIDEBAR` removed** after its default-on soak (its own
  comment said "Remove the lever after the default-on soak"). The bounded
  window + pinned read (ADR-0005) is the only sidebar path; the legacy
  full-list subscription and the unbounded `chats.getForCurrentUser` Convex
  query are deleted. The compile-time guard tying the bounded sidebar to
  `chats.searchByTitle` remains.
- **`CHAT_CONDITIONAL_EXA` (PR 7b) removed** — it also defaulted OFF, leaving
  the verified conditional read dormant. The two-door gate (Layer 2 search
  fallback | content extraction) is now unconditional; the gate tests assert
  the conditional behavior directly (zero reads with both doors closed,
  exactly one read per open door, identical tool exposure).

## What deliberately remains

- `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION` / `CHAT_PERF_SAMPLE_RATE` — the
  off-by-default diagnostic kit (not behavior).
- `NEXT_PUBLIC_ENABLE_DURABLE_RUN_PRESENTATION` — gates genuinely unverified
  product presentation behind a manual checklist; a flag doing its job.
- `GROWING_HIGHLIGHT_THROTTLE_MS = 300` and `CHAT_MESSAGE_THROTTLE_MS = 50`
  as named constants — tuning knobs are code changes now.
