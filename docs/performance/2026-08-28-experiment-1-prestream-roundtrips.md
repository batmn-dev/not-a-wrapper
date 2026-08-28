# Experiment 1 — reduce pre-stream server round-trips

Date: 2026-08-28 · Before: commit `4b7f31e4`, result
`2026-08-27T23-45-14-durable.json` / `2026-08-27T20-55-52-standard.json` ·
After: this change, results `2026-08-28T00-02-51-durable.json` /
`2026-08-28T00-06-00-standard.json`. Same machine, build class
(instrumented production, `.next-perf`), fixtures, deterministic provider,
and suite configuration (10 runs after 2 warmups). All scenarios green on
the blocking correctness checks in both runs.

## Change

Three overlaps plus one instrumentation split, all at the route/adapter
level — no authorization ordering was weakened:

1. **Abuse check ∥ attachment preflight ∥ key-settings read** — three
   independent reads run concurrently at admission entry. The allowance
   reservation still starts only after the abuse gate passes, and an
   abuse-check failure keeps precedence over a preflight failure
   (`Promise` siblings carry no-op catches so an early rejection is never
   unhandled).
2. **Key-settings prefetch consumed by the route resolver** — 
   `resolveModelRoute` now merges partial dep overrides; credential
   resolution awaits the admission-started read instead of issuing its own.
3. **Usage increment off the critical path** — started in its historical
   order (after reservation arming, so the release hook is armed if it
   fails) but awaited after `prepare_total`, strictly before streaming. A
   late increment failure now fails a *prepared* turn through `turn.fail()`
   (durable run marked failed, reservation settled through the run
   lifecycle) instead of failing pre-runtime — a rare, well-defined path.
4. **`usage_reservation` sub-span** — the reservation mutation is now
   measured on its own inside `credential_resolution`.

## Results (mixed-markdown 30 cps fixed, p50 of 10 runs)

| Metric | Before | After | Δ |
|---|---|---|---|
| `usage_admission` | 234.7 ms | 135.4 ms | **−99 ms** |
| `credential_resolution` | 114.9 ms | 56.8 ms | −58 ms |
| `usage_reservation` (new) | — | 56.6 ms | reservation ≈ all remaining credential cost |
| `attachment_resolution` | 41.7 ms | 71.2 ms | span now includes its concurrent window (overlap artifact, not a regression — admission total shrank) |
| `durable_prepare` / `prepare_total` / `settlement_total` | 69.0 / 173.8 / 276.5 | 70.1 / 174.5 / 278.5 | unchanged (control) |
| **receipt → provider start** | **405 ms** | **317 ms** | **−88 ms (−22 %)** |
| client dispatch → first stream chunk | 436.9 ms | 343.3 ms | −94 ms |
| send → first visible text | 828.7 ms | 732.2 ms | −96 ms |
| guest `usage_admission` | 67.4 ms | 26.8 ms | −41 ms |
| guest receipt → provider start | 68.5 ms | 67.0 ms | unchanged — the guest prepare window (~1 ms) cannot hide the increment await; expected |

Cold/warm credential paths: the harness user has no BYOK keys, so this
measures the platform-reservation path; the BYOK `getUserKey` round-trip is
untouched by this change.

## Correctness

Full vitest suite green (272 files / 2,566 tests) with the ordering test
updated to the new contract; both benchmark runs passed every blocking
check (fold hash / settlement rules, expected outcomes, zero settle
mismatches); durable Stop, second-tab freshness, and reload recovery
metrics unchanged within noise.

## Remaining pre-stream structure (~317 ms)

admission ~135 (preflight 71 as the concurrent critical path + reservation
57) + prepare ~175 (durable prepare 70, validations, trusted-text fetch) +
runtime construction. The next candidate — overlapping the reservation with
`durable_prepare` — crosses an ADR-0021 boundary (`prepareGeneration`
attaches the reservation id), so it is a separate, riskier experiment, not
an extension of this one.
