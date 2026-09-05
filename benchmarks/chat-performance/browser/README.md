# Chat responsiveness benchmarks

The real production application with only the provider replaced by a deterministic
script. Stream correctness gates every timing result. See ADR-0035 and
`docs/performance/metric-dictionary.md` group 14 for the measurement contract.

```sh
NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION=true NEXT_DIST_DIR=.next-perf bun run build:next
PERF_CDP_URL=http://localhost:9222 SUITE=responsiveness RUNS=5 bun run bench:browser
```

Local runs attach an existing authenticated Chrome session; no separate browser is
launched. The app must be signed in at the benchmark origin. The harness starts an
isolated production server on `PERF_PORT` (default 3111); `BASE_URL` instead reuses
an existing server and cannot join its server logs. It never uses the developer's
port 3000. A Chrome extension alone supports manual validation, not this terminal
harness. Do not restart the user's browser to obtain CDP access.

## Suites

- `responsiveness`: cold HTTP-cache entry; follow-up in a seeded existing chat;
  reasoning before text; typing, menu opening, and scrolling during a long answer;
  one mobile viewport + 4x CPU + constrained-network repeat; Stop; partial error.
  Late typing/menu/scroll waits for 80% of fixture content while streaming remains
  active, with separate early/late timing coverage.
- `thread-switch`: newly seeded deterministic chats, including one long answer.
  Unvisited clicks, hover-prefetched clicks, and visited switches. Browser-observed
  destination frames, cache classifications, subscription counts, retained heap.
- `standard`: existing guest rendering/delivery-shape stress cases (CI only).
- `durable`: existing signed-in stream, second-tab, reload, Stop, and paused-stream
  durability cases. The initial foreground observation is frozen before an
  intentional second-tab focus transfer.
- `smoke`: three guest stream cases for CI harness bring-up.

`RUNS` defaults to 10, `WARMUPS` to 2. Five complete measured runs are the minimum
for comparison; lower counts are diagnostic only. `ONLY` filters by scenario ID.
The core suite's cold entry disables the HTTP cache. CI uses a fresh authenticated
context for each cold sample; attached Chrome preserves the person's cookies and
storage. Warm scenarios reuse assets across new documents. The visited-switch pass
separately tests the live in-memory conversation cache.

The constrained profile is 4x CPU, 150 ms added latency, 1.6 Mbps download and
750 Kbps upload. Its numbers compare only against that same profile. A narrow
viewport by itself is not a phone-performance simulation.

## Evidence and gates

Schema-v2 JSON retains content-free per-run observations and n/p50/p75/max
aggregates. p95 exists only from 20 observations. The activating click/Enter is
the start of perceived-latency measurements. The observer checks the relevant DOM
before a frame and records after its paint opportunity. These are DOM/frame
proxies, not first-pixel timestamps; old React-effect marks remain separate.

Continuous receipt-to-content samples match a text-source watermark, at most four
times per second, to the current assistant's rendered source. They exclude provider
silence but do not prove off-screen characters painted. A known fixture checks
stream byte fidelity; a 250 ms post-Stop observation checks text no longer grows.
Hidden tabs invalidate interactive observations. Do not remove slow/failed runs.
Menu-consumed Enter does not begin a send measurement. Coalesced typing retains
the oldest waiting input. Completed foreground runs fail if any sampled content
never reaches the rendered watermark; buffer overflow also fails explicitly.

Normal-profile budgets allow at most 5% over 100 ms for Send/Stop/menu feedback,
and 50 ms for typing and received-content frames. Relative gates cover load,
first output, server preparation, settlement, and navigation. These are targets,
not claims that the current app passes.

`compare-results.ts` validates schema, sample coverage, correctness, complete
scenario identity (including delivery shape), fixture hash, and matching hardware
and browser. Missing baselines fail. Explicit `--collect-baseline` validates first
evidence without claiming a relative comparison. Follow `baselines/README.md`;
old schema-v1 artifacts cannot arm this gate.

Same-repository relevant PRs run the core suite. Weekly CI runs standard, durable,
and thread-switch suites. Fork PRs receive no credentials. Setup requires the
existing `PERF_ENV_FILE` and `PERF_AUTH_PASSWORD` GitHub secrets and fresh reviewed
runner-specific baselines. Results upload even on failure.

## Diagnostics outside the core gate

`composer-shell.ts` remains the specialized saved-label/CLS/TTFB check.
`trace-attribution.ts` remains the detailed main-thread attribution tool. Neither
is a substitute for ready-to-type/ready-to-send measurements. Production Sentry
collection is opt-in (`NEXT_PUBLIC_CHAT_UI_SAMPLE_RATE`, default 0) until overhead
is measured; see the runbook for the A/B and actual event-arrival verification.
Real-provider first-output/token-rate analysis stays separate, grouped by the real
provider route, reasoning setting, tool configuration, and outcome.
Production sampling discards interrupted turns on tab return and resumes for new
turns; benchmark documents retain the stricter permanent visibility invalidation.
