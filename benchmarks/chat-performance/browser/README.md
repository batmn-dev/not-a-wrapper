# Chat responsiveness benchmarks

The real production application with only the provider replaced by a deterministic
script. Stream correctness gates every timing result. See ADR-0037 and
`docs/performance/metric-dictionary.md` group 14 for the measurement contract.

```sh
NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION=true NEXT_DIST_DIR=.next-perf bun run build:next
PERF_CDP_URL=http://localhost:9222 SUITE=responsiveness RUNS=5 bun run bench:browser
```

Local runs attach an existing authenticated Chrome session; no separate browser is
launched. The app must be signed in at the benchmark origin. The harness starts an
isolated production server on `PERF_PORT` (default 3111) with the deterministic
provider enabled. `BASE_URL` and port 3000 are rejected, preventing accidental
real-provider requests to an ordinary app server. A Chrome extension alone supports manual validation, not this terminal
harness. Do not restart the user's browser to obtain CDP access.

CI uses `ci-isolated-v1`: one newly provisioned WorkOS identity per harness
process, with a UUID suffix even when `PERF_AUTH_EMAIL` supplies the email base.
The real login and Convex bootstrap give each capture its own sidebar history
and usage allowance. Setup is outside measured interactions. Chats accumulate
only within that capture's configured scenario/warmup order. Local attached
Chrome keeps the person's existing identity and history (`attached-session-v1`).
Comparisons require the same identity protocol.

Generated test users and fixture data are retained in the benchmark environment.
They do not enter later captures; automatic deletion is deliberately absent
because the existing WorkOS deletion hook only disables the app user, without
removing its chats or accounting records. Environment maintenance is separate
from benchmark measurement.

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
for comparison; lower counts are diagnostic only. `ONLY` filters by scenario ID
except in the `thread-switch` suite, which always runs its complete journey.
The core suite's cold entry disables the HTTP cache. CI uses a fresh authenticated
context for each cold sample; attached Chrome preserves the person's cookies and
storage. Warm scenarios reuse assets across new documents. The visited-switch pass
separately tests the live in-memory conversation cache.

The constrained profile is 4x CPU, 150 ms added latency, 1.6 Mbps download and
750 Kbps upload. Its numbers compare only against that same profile. A narrow
viewport by itself is not a phone-performance simulation.

## Evidence and gates

Workflow dispatch `diagnose=true` supports only `suite=responsiveness` and records
one profiled run per `only` scenario ID (default: `new-chat-cold,interact-long-answer`).
Other suites are rejected before setup; disable `diagnose` to run them normally.
Diagnostics skip performance certification, and profiled results are rejected as
baselines. The separate `perf-diagnostics` artifact contains `.cpuprofile` files,
browser timeline `.trace.json` files, and the matching public JavaScript chunks
for locating sampled functions. These developer diagnostics are separate from
the content-free measurement JSON in `perf-results`.

With `diagnose=true`, `observer_overhead=true` instead runs one warmup pair and
five alternating observer-on/off pairs through the existing trace tool. It checks
the full stream oracle and foreground state, then compares native main-thread
work and Event Timing entries in `perf-observer-overhead`. The same build and
fresh guest setup are used for both arms. This measures incremental benchmark
DOM observer cost during Send-to-terminal; it excludes startup and production
Sentry reporting and cannot be used as
a responsiveness baseline or an INP measurement.

Schema-v2 JSON retains content-free per-run observations and n/p50/p75/max
aggregates. p95 exists only from 20 observations. The activating click/Enter is
the start of perceived-latency measurements. The observer checks the relevant DOM
in a rendering callback and records in a task queued after that rendering
opportunity (`dom-frame-v3`). V3 follows finite reveal animations to their first
visible frame; v2 could wait for another stream chunk after an opacity-zero scan.
V1's extra animation-frame wait remains removed. Earlier captures are incompatible
and must be repeated. These are DOM/frame
proxies, not first-pixel timestamps; old React-effect marks remain separate.

All scripted typing uses the same 40 ms key cadence, including fixture setup and
the early/late draft probes. `typingCadenceMs` is required environment metadata.
Zero-delay automation can starve post-frame timers while frames continue, so its
timer durations are not comparable with this interaction profile. Budgets stay
unchanged; the timestamp still includes the entire observed interval.

Continuous receipt-to-content samples match a text-source watermark, at most four
times per second, to the current assistant's rendered source. They exclude provider
silence but do not prove off-screen characters painted. A known fixture checks
stream byte fidelity. Stop checks current-assistant source length at ready,
250 ms later, and after the terminal/settlement wait and settling buffer. Each
sample must be no longer than the previous one; a shorter canonical snapshot is
valid. Passing Stop evidence requires `stopSourceLengths.afterSettlement`.
Authenticated Stop also requires an observed `aborted` settlement outcome;
a locally aborted stream alone does not establish the persisted result.

Long-task and rAF-gap marks retain `observedStartMs`. Their observed intervals
are included when they overlap the send-to-terminal window, even when the
observer callback arrives after terminal. Full overlapping durations remain
diagnostic observations; callback delivery time does not determine inclusion.
Hidden tabs invalidate the entire run; do not interpret any of its timings. Do not remove slow/failed runs.
Menu-consumed Enter does not begin a send measurement. Coalesced typing retains
the oldest waiting input. Completed foreground runs fail if any sampled content
never reaches the rendered watermark; buffer overflow also fails explicitly.
An eligible transcript wheel waits for movement in its requested direction,
retaining the oldest pending timestamp across rendering opportunities. Cancelled
or competing input, opposite movement, navigation/root changes, and application
scroll commands invalidate the pending observation. A five-second watchdog fails
an unmatched capture without truncating an accepted duration. Native scroll
anchoring has no causal input identifier; this remains a DOM/frame proxy.
Interaction captures declare `wheelProtocol: prepared-wheel-v1`. Immediately before
native input, the harness supplies the observer with the root's position and the
expected delta. The actual wheel event consumes that preparation once and supplies
the latency timestamp. This preserves scrolling that occurs before passive event
delivery without changing browser scheduling. Missing, stale, mismatched, or
invalidated preparation fails; older interaction captures are incompatible.
Failure probes retain only closed wheel-state reasons, counts, timings, and scroll
positions to distinguish skipped eligibility from delayed event delivery.

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
