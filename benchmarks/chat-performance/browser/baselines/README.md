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

## Activation status (2026-08-28)

- `PERF_ENV_FILE` repo secret: **set** (from the perf server's `.env.local`).
- `PERF_AUTH_PASSWORD` repo secret: **set** (dedicated benchmark credential).
- First run + baseline: `workflow_dispatch` requires the workflow file on the
  default branch, so this happens right after the branch merges to `main`:

  ```
  gh workflow run perf-benchmark.yml -f suite=smoke
  gh run list --workflow=perf-benchmark.yml    # note <run-id>, wait for green
  gh run download <run-id> -p "perf-results-smoke-*" -D /tmp/perf-results
  cp /tmp/perf-results/*/[0-9]*-smoke.json \
    benchmarks/chat-performance/browser/baselines/ci-smoke.json
  # commit ci-smoke.json — the comparison step gates from the next run on
  ```
