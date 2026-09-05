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

`dom-frame-v3` captures include finite reveal-animation observation and require
`typingCadenceMs: 40` for setup and interaction typing. Earlier zero-delay setup
captures and v2's mutation-only reveal observations cannot seed these baselines.

Interactive scrolling scenarios require `wheelProtocol: "prepared-wheel-v1"`:
the harness captures position before native input, then measures from the actual
wheel event to observed movement. Scenario matching rejects older scroll captures
that sampled their starting position inside a potentially delayed passive handler.
Non-scrolling scenarios are unaffected by this protocol field.

Captures also require `replayPolicy: "disabled-v1"`. Performance builds disable
Sentry and PostHog session recording at initialization while retaining other
telemetry; normal production recording behavior is unchanged. A browser marker
verifies this policy before collection. Remote replay configuration and random
session sampling must not vary the core benchmark workload. These captures
exclude replay overhead; production RUM still measures the whole application.
Collect fresh artifacts under this policy. Never add the field to an older
capture to make it comparable.

Local first-evidence validation:

```sh
bun run benchmarks/chat-performance/browser/compare-results.ts --collect-baseline path/to/current.json
```

This explicitly checks correctness, coverage, and absolute budgets but performs no
relative comparison. It cannot be used to report regression protection as armed.
