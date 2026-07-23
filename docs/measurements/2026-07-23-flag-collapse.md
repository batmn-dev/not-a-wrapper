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

## What deliberately remains

- `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION` / `CHAT_PERF_SAMPLE_RATE` — the
  off-by-default diagnostic kit (not behavior).
- `CHAT_CONDITIONAL_EXA` (PR 7b) — separate work stream, still in its soak.
- `GROWING_HIGHLIGHT_THROTTLE_MS = 300` and `CHAT_MESSAGE_THROTTLE_MS = 50`
  as named constants — tuning knobs are code changes now.
