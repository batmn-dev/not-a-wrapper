# Browser performance baselines

The comparator now **fails when a baseline is missing**. A green correctness run
alone is never proof of speed. There are currently no schema-v2 CI baselines;
collect them on the actual runner after this workflow is available on GitHub.

1. Dispatch `perf-benchmark.yml` with the desired suite and `collect_baseline=true`.
2. Review the uploaded JSON, correctness, sample coverage, and absolute budgets.
   Failed budgets remain failures even during collection; investigate them rather
   than raising thresholds to normalize a slow baseline.
3. Commit the reviewed artifact as `ci-<suite>.json` in this directory.
4. Run the workflow normally to prove the strict comparison passes.

Suites: `responsiveness`, `standard`, `durable`, `thread-switch`, and optional
`smoke`. Never use a local Mac result as a Linux CI baseline. Schema version,
measurement version, exact browser version, CPU model/count, memory class, fixture
hash, identity protocol, and scenario conditions must match. CI captures begin
with a fresh authenticated identity; attached personal sessions have a different
protocol and cannot seed CI baselines. Refresh deliberately when conditions change.

Local first-evidence validation:

```sh
bun run benchmarks/chat-performance/browser/compare-results.ts --collect-baseline path/to/current.json
```

This explicitly checks correctness, coverage, and absolute budgets but performs no
relative comparison. It cannot be used to report regression protection as armed.
