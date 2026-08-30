# Chat-performance measurement runbook

Use the deterministic browser harness for comparable performance measurements.
It covers guest and authenticated durable scenarios, enforces correctness before
reporting timings, and writes ignored JSON results under
`benchmarks/chat-performance/browser/results/`.

## Standard run

```bash
NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION=true NEXT_DIST_DIR=.next-perf bun run build:next
bun run bench:browser
```

The isolated `.next-perf` build and default benchmark port do not disturb the
developer-owned server on port 3000. Harness options and durable-suite setup are
documented in `benchmarks/chat-performance/browser/README.md`.

Interpret results using:

- `docs/performance/metric-dictionary.md` for metric definitions and privacy
  rules;
- `docs/performance/2026-08-27-system-performance-baseline.md` for the pinned
  runner class, fixture hashes, and comparison baseline.

## Manual measurement

Use an authenticated Chrome session only when the deterministic harness does
not cover the question, such as a real-provider cadence, a third-party product
comparison, or trace-level browser paint attribution.

Keep comparisons controlled:

- use a production build, never development mode;
- record normal and 4x CPU runs;
- record desktop and representative mobile viewports;
- record warm or cold cache state;
- compare identical prompts, provider routes, and stream shapes;
- separate foreground HTTP rendering from Convex snapshot/recovery timing.

Client instrumentation is build-time gated by
`NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION=true`. Server spans are sampled with
`CHAT_PERF_SAMPLE_RATE=<0..1>`. Join them with the generated correlation ID;
never persist that ID as application data.

## Privacy and evidence

Performance evidence must remain content-free. Never retain prompts, responses,
cookies, authorization headers, API keys, user IDs, chat IDs, or raw tool data.
Publish only aggregate metrics and stable architectural conclusions in this
repository. Raw traces, screenshots, downloaded bundles, and source-product
captures belong in ignored benchmark results or the sibling `reference-ui`
repository, not `docs/`.

Before treating instrumentation numbers as user-facing truth, compare an
instrumented and uninstrumented build of the same deterministic scenario. The
instrumented run must not introduce a new task longer than 50 ms.
