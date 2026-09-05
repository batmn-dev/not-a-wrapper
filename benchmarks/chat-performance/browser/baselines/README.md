# Browser performance baselines

The comparator now **fails when a baseline is missing**. A green correctness run
alone is never proof of speed. Reviewed captures are stored below by suite and exact runner environment.
A capture alone does not prove an independent comparison passes.

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
strict environment fields as comparison: measurement version, typing cadence,
replay policy, identity protocol,
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

Streamed-content captures require `contentFrameProtocol: publisher-frame-v1`.
When the SDK publishes inside an animation frame, the observer can inspect the
committed source watermark in that same rendering opportunity. Deferred commits
retain the normal observation fallback. Both paths timestamp a later task; neither
claims pixel presentation. Old streamed-content captures are incompatible. The
thread-switch-only suite has no streaming scenarios and is unaffected.

Interactive scenarios also require `menuProtocol: "activation-v1"`. Menu timing
starts at primary pointerdown before native mousedown opening work, with a
keyboard-generated activation fallback. Closing clicks cannot arm an opening.
Older click-anchored interactive captures are incompatible; non-interactive
suites are unaffected.

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

Reviewed thread-switch capture: [run 33958084155](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33958084155),
commit `7026cbad`, AMD EPYC 9V74, Chromium `151.0.7922.34`. All 90 switches pass
correctness and coverage (20 unvisited-click, 20 unvisited-hover, 50 visited).
The long Markdown fixture accounts for every sample above 150 ms; those samples
are retained. Median navigation is 45–48 ms and p95 is 601–829 ms. These tails
are measured existing behavior, not proof of fast navigation. The independent
normal comparison is recorded below. Other suites remain pending.

Reviewed AMD EPYC 7763 capture: [run 33960196987](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33960196987),
commit `36f21d1b`, build `KelASso9apfbIAqom0pYJ`, Chromium `151.0.7922.34`,
Linux x64 with 4 logical CPUs and 16 GB memory. This production instrumented
capture uses `dom-frame-v3`, `ci-isolated-v1`, `disabled-v1` replay policy,
40 ms typing, and fixture hash `87cb69eed4321f7b`; profiling is off.
All 90 switches pass correctness and strict collection validation
(20 unvisited-click, 20 unvisited-hover, 50 visited across 8 chats).
Their respective navigation p50 values are 71, 53.6, and 48.8 ms; p95 values are
1062.4, 1082.6, and 820.2 ms. Every sample above 150 ms is the long Markdown
fixture, and all samples are retained unchanged. Unvisited clicks have 20 cache
misses; hovered and visited switches have 20 and 50 cache hits respectively.
The normal workflow failed only because this exact CPU environment had no
baseline. Reviewing and collecting that artifact does not convert the failed run
into a comparison pass: an independent normal comparison is still required.

Heap evidence has an independent marker: `threadSwitch.heapProtocol: forced-gc-v1`.
New captures require successful GC and a valid heap reading at every configured
checkpoint. Historical captures without the marker remain latency baselines;
their heap readings cannot prove that GC succeeded and are diagnostic only.
Early/late interaction phases use the same absolute budgets independently of
pooled samples, and every text scenario requires per-run content-latency evidence.

Independent thread-switch comparison passed in
[run 33966180716](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33966180716)
at `905f042f`, build `RMitC1zNfrZaMAuQM4H13`, on AMD EPYC 9V74 and Chromium
151.0.7922.34, against the committed 9V74 baseline from run 33958084155.
All 90 switches pass. Unvisited-click/hover/visited medians are 54.6/48.8/45.3 ms
and p95 values 774.4/799.9/562.3 ms. Unvisited click means no prior navigation
in that document, not forced cache misses: the new pass has 11 hits/9 misses
(the matching baseline has 14/6). Normal pointer/click warming remains enabled;
cache labels describe authoritative data readiness at route commit, not its origin.
Hover and visited passes have 20 and 50 hits. Long-destination tails are retained.
The capture records `forced-gc-v1` and all 0/10/25/50 checkpoints. Heap is
25.253/26.012/38.970/27.125 MiB respectively; 25 contains the long chat, while
10 and 50 contain the same short chat. This finite traversal is not leak proof.
