# Browser performance baselines

The comparator now **fails when a baseline is missing**. A green correctness run
alone is never proof of speed. There are currently no schema-v2 CI baselines;
collect them on the actual runner after this workflow is available on GitHub.

1. Dispatch `perf-benchmark.yml` with the desired suite and `collect_baseline=true`.
2. Review the uploaded JSON, correctness, sample coverage, and absolute budgets.
   Failed budgets remain failures even during collection; investigate them rather
   than raising thresholds to normalize a slow baseline.
3. Commit the reviewed artifact as `ci-<suite>/<environment>.json` in this
   directory. Choose a descriptive filename for the captured CPU and browser;
   matching uses the parsed metadata, never the filename or timing values.
4. Run the workflow normally to prove the strict comparison passes.

Suites: `responsiveness`, `standard`, `durable`, `thread-switch`, and optional
`smoke`. Never use a local Mac result as a Linux CI baseline. Schema version,
measurement version, exact browser version, CPU model/count, memory class, fixture
hash, identity protocol, and scenario conditions must match. CI captures begin
with a fresh authenticated identity; attached personal sessions have a different
protocol and cannot seed CI baselines. Refresh deliberately when conditions change.

GitHub-hosted runners can have different CPUs. Each suite directory contains
exactly one reviewed JSON per environment. Directory selection uses the same
strict environment fields as comparison: measurement version, identity protocol,
build class, instrumentation setting, machine class, CPU model/count, memory,
browser version, fixture hash, and suite. Schema validation still applies to every
candidate. Zero matches, duplicate matches, and invalid JSON fail; another CPU's
baseline is never a fallback. Scenario identity, coverage, and budgets remain
checked after selection. Do not add placeholders for environments not yet captured.
An explicit baseline JSON path remains supported for inspecting one capture.

Local first-evidence validation:

```sh
bun run benchmarks/chat-performance/browser/compare-results.ts --collect-baseline path/to/current.json
```

This explicitly checks correctness, coverage, and absolute budgets but performs no
relative comparison. It cannot be used to report regression protection as armed.
