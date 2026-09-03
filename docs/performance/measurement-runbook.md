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

## Reading run timing receipts (production or dev)

Every durable generation run carries a **Run timing receipt** (ADR-0030,
metric dictionary group 13). To ask "did build X slow prepare for route Y",
summarize completed runs in a window, grouped by model, route, and build:

```bash
# Last 7 days, computed at run time; change the day count to widen the window.
bunx convex run runTiming:timingSummary "{\"sinceMs\": $(( $(date +%s) * 1000 - 7*24*60*60*1000 ))}"
```

`sinceMs` is optional and defaults to the last 24 hours. Keep the window
recent: the query returns at most `"limit"` runs, newest first, so a window
holding more completed runs than the limit silently drops the oldest ones.
`scannedRuns` equal to the limit means the window was capped. Optional
filters: `"model"`, `"buildId"` (the server build identifier stamped on the
run: the short commit SHA, or the Sentry release when the SHA is unavailable),
`"limit"` (default 2000, max 5000); filters apply within the returned window
(the newest `limit` completed runs), so when `scannedRuns` equals the limit a
filtered summary can omit older matches: narrow `sinceMs` or raise `limit`.
`matchedRuns` counts the runs the filters kept. The result lists n, p50,
and max per receipt segment plus the derived `serverTimeToFirstOutputMs` and
`pacingOverheadMs`; `p95` appears only from 20 samples up (the dictionary's
non-metrics rule). Add `--prod` to read the production deployment. Compare
two builds side by side by running it twice with each `buildId`; local runs
carry no build id. Stopped runs carry the partial receipt their worker
attached after the Stop; runs the reaper closed carry none.

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
- confirm the web-search state per account before a "search off" cell: the
  preference defaults to on, the composer shows no indicator, and a declared
  hosted `web_search` tool bills ~4.4K hidden input tokens on OpenAI (1,026
  on Haiku, 552 on GLM) whether or not the model searches; check
  `toolMetadataByName` on the stored message (see
  `2026-09-02-ttft-tps-vs-t3-chat.md`, Follow-up);
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
