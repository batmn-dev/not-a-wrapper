# CI benchmark baselines

Checked-in reference results for `.github/workflows/perf-benchmark.yml`'s
regression gate (`compare-results.ts`). One file per suite, named
`ci-<suite>.json` (e.g. `ci-smoke.json`).

- Baselines are **runner-class-specific**: capture them from a green CI run's
  results artifact, never from a local machine.
- Until a suite's baseline exists, the workflow's comparison step reports
  and passes — correctness (the harness's own exit code) still gates.
- Regenerate a baseline deliberately when fixtures change (the pinned
  payload hashes in `../../fixtures.test.ts` fail on drift) or after an
  accepted performance change moves the numbers.
