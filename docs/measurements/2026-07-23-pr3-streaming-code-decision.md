# PR 3 — streaming code rendering: variant decision (2026-07-23)

Decision record for the chat-responsiveness plan's PR 3
(`docs/gameplans/chat-responsiveness-performance-implementation-plan.md`):
which `NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE` variant to prefer when the
flag is enabled. **Both variants are implemented; the flag default remains
`legacy`** (rollback path). **Recommended enablement mode:
`throttled-highlight`** — the plan's preferred variant passes its own
fallback criterion.

## The criterion (plan PR 3 scope note)

Evaluate throttled re-highlighting (growing terminal block, at most one
highlight per `GROWING_HIGHLIGHT_THROTTLE_MS` = 300 ms) first; fall back to
`plain-while-growing` only if throttled highlighting still produces **>50 ms
long tasks on the 250–500-line fixtures** at the PR 2 throttle.

## Measurements

`bun run bench:chat` (vitest bench, tinybench), repo @ PR 2+PR 3 changes.
Environment: Apple M4 Max (16 cores), macOS 25.5.0 arm64, Node v25.8.1 — the
documented repository benchmark environment (same as the PR 0a baseline).

| Measure | Result |
| --- | --- |
| Shiki highlighter initialization (cold) | 24.2 ms (one-time, counted separately per plan step 7) |
| One settled 400-line TypeScript highlight | **16.0 ms median / 17.4 ms max** (15 samples) |
| Per-delta replay across 45 growth states (legacy behavior) | ~370 ms cumulative per pass |
| Splitter, settled ~12 KB payload (block records) | 9.3 ms median — in line with the PR 0a baseline; the record shape added no measurable cost |

Deterministic call-count gate (`components/ui/code-block.test.tsx`, fake
timers, mocked Shiki): a 400-line block streamed as 40 deltas at the PR 2
50 ms cadence produces **8 highlights in throttled-highlight mode
(bounded by ceil(streamMs/300)+3) vs 40 in legacy**, plus one settle
highlight; `plain-while-growing` produces 0 during continuous growth plus
debounce/settle highlights. Never one highlight per delta in either variant
(plan §8.1.4 gate).

## Why throttled-highlight

- The worst single unit of main-thread work it can schedule — one full
  highlight of the ~full 400-line block — measures **16 ms**, well under the
  50 ms long-task threshold on the documented environment. The fallback
  criterion does not trigger.
- It preserves ChatGPT's highlight-while-streaming look (standing product
  goal); `plain-while-growing`'s plain-then-pop visibly diverges.
- Highlight work drops from O(deltas) (~370 ms cumulative per 45-state pass)
  to O(stream-seconds / 0.3) with a hard per-interval bound.

Caveats recorded honestly:

- Under Chrome **4× CPU slowdown** a ~16 ms highlight extrapolates to ~64 ms —
  above the threshold, at most once per 300 ms. If the staging pass (plan
  §9.2, production build, 4× slowdown) shows this harming input delay,
  `plain-while-growing` is the same-flag fallback with zero code change.
- Blocks far beyond ~500 lines raise the per-highlight cost; the plan
  explicitly defers "extremely large settled blocks" and web-worker Shiki.

## Live verification (2026-07-23, user's dev server @ localhost:3000)

Dev build, flag unset → `legacy` mode active (the shipped default), with the
PR 3 block-record model and status threading live:

- Streamed TypeScript/Python/Go/Rust code answers: per-delta highlighted
  growth, settled highlight, sticky header/label intact.
- Copy during growth returned the raw code (3,392 chars, no HTML markup).
- Theme switch (light → dark) re-highlighted settled blocks
  (`shiki github-dark`); setting restored to System afterwards.
- Reload during/after generation rehydrated the full durable conversation,
  including a 16.4 KB highlighted block; a historical aborted turn still
  renders its "Generation stopped. Partial response preserved." stub.
- No console errors.
- **Observed:** 400-line-plus streams under the dev build froze the main
  thread for tens of seconds in legacy mode (per-delta full-block highlight +
  full re-parse), long enough that a Stop click could not land — the measured
  pathology this PR eliminates when the flag is enabled. Stop/error partial
  behavior is pinned by the PR 2 seam tests and the unclosed-fence-at-Stop
  unit test instead.

Variant behavior cannot be exercised on the running dev server — the flag is
build-time — so throttled-highlight's visual pass happens on the §9.2 staging
build alongside PR 2's texture comparison.
