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

Workflow dispatch `diagnose=true` supports `suite=responsiveness` and `standard`,
recording one profiled run per `only` scenario ID. Blank `only` defaults to
`new-chat-cold,interact-long-answer` for responsiveness and
`mixed-markdown-30-slab` for standard. Other suites are rejected before setup;
disable `diagnose` to run them normally. Observer/rendering controls still
require responsiveness.
Diagnostics skip performance certification, and profiled results are rejected as
baselines. The separate `perf-diagnostics` artifact contains `.cpuprofile` files,
browser timeline `.trace.json` files, and the matching public JavaScript chunks
for locating sampled functions. These developer diagnostics are separate from
the content-free measurement JSON in `perf-results`.

For focused style attribution, `diagnose=true, late_menu_trace=true` with
`only` left blank defaults to `interact-long-answer` and records invalidations
around the late menu opening. Local equivalent:
`PERF_PROFILE=true PERF_PROFILE_LATE_MENU=true`.
The native artifact is explicitly named `.late-menu.trace.json`; an interrupted
capture is `.late-menu.partial.trace.json`. CPU profiling still covers the journey.
This mode cannot combine with other diagnostic controls or non-interactive
scenarios, and supplies no whole-journey native-work total or certification.

With `diagnose=true`, `observer_overhead=true` instead runs one warmup pair and
five alternating observer-on/off pairs through the existing trace tool. It checks
the full stream oracle and foreground state, then compares native main-thread
work and Event Timing entries in `perf-observer-overhead`. The same build and
fresh guest setup are used for both arms. This measures incremental benchmark
DOM observer cost during Send-to-terminal; it excludes startup and production
Sentry reporting and cannot be used as
a responsiveness baseline or an INP measurement.

The manual `diagnose=true, rendering_probe=true` control captures Smooth, Quick,
and Smooth with injected `.text-message, .text-message > div { display: flow-root !important; }`,
labeled `inner-block-layout`. The third arm tests block layout without changing product CSS. Each capture requires
the complete stream oracle and records the injected stylesheet hash and final
geometry. Compare the two Smooth arms for containment; Quick isolates the fade.
These traces are diagnostic and cannot seed performance baselines.

Schema-v3 JSON retains content-free per-run observations and n/p50/p75/max
aggregates. p95 exists only from 20 observations. The activating click/Enter is
the start of perceived-latency measurements. The observer checks the relevant DOM
in a rendering callback and records in a task queued after that rendering
opportunity (`dom-frame-v3`). V3 follows finite reveal animations to their first
visible frame; v2 could wait for another stream chunk after an opacity-zero scan.
V1's extra animation-frame wait remains removed. Earlier captures are incompatible
and must be repeated. These are DOM/frame
proxies, not first-pixel timestamps; old React-effect marks remain separate.

`navigationToSendControlEnabledMs` reports the enabled button with probe text;
`navigationToSendReadyMs` requires that state and matching-account admission
simultaneously. Both revisions publish the same observation-only predicate; the
original-base overlay leaves its product gate unchanged. Required
`accountReadinessProtocol: matching-account-v1` rejects older readiness captures.

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
Result schema v3 uses the conventional middle-pair median for even sample counts;
older schemas are rejected. Tail percentile formulas and all gates are unchanged.
Menu-consumed Enter does not begin a send measurement. Coalesced typing retains
the oldest waiting input. Completed foreground runs fail if any sampled content
never reaches the rendered watermark; buffer overflow also fails explicitly.
Benchmark scrolling gates `scrollBrowserToPresentationMs`: Chromium's explicit
`GenerationToBrowserMain` endpoint through `SwapEndToPresentationCompositorFrame`.
CDP timestamps synthetic wheel input before a visual-state synchronization barrier;
`scrollAutomationDispatchMs` reports that pre-forward interval separately. The raw
`scrollInputToPresentationMs` total remains visible, but is not a physical-input
latency claim or regression gate. Both components must sum to that total. An
isolated wheel event and its UserTiming anchor identify one category/process/local
async track within a complete bounded interval. Scroll protocol v2 follows the
exact submitted scroll frame using lossless input, surface, and display IDs plus
the input's native frame-swap timestamp. This avoids crediting a later original
main frame when the scroll already appeared on a forked compositor frame. Direct
input-track attribution applies only when the submission path is unavailable.
Version 1 captures cannot be relabeled. Missing, ambiguous, incomplete,
or lost native evidence fails collection. Menu input must follow the wheel's
native presentation; the handoff uses one rAF-to-task opportunity. The late menu
is clicked natively at its verified pre-wheel position in the sticky composer,
avoiding extra locator stability waits. Its actual pointerdown must open the menu
while streaming remains active; no retry or fallback is permitted. Interaction v2 rejects
the earlier two-rAF/locator-click sequencing.
`wheelProtocol: native-browser-presentation-v2`
and `interactionProtocol: late-typing-native-wheel-menu-v2` reject older captures.
Normal runs retain native traces in CI artifacts without CPU profiling and disable
the old geometry-reading wheel observer. Production `scrollToFrameMs` remains a
DOM/frame movement proxy. Neither metric establishes physical pixel timing, and
the protocol change alone is not evidence of improved responsiveness.

Menu samples use `menuProtocol: activation-v1`: primary pointerdown opening intent
to the observed frame, with a keyboard activation fallback. This includes native
menus that open on mousedown before click, as well as desktop click-open menus.
Closing or cancelling clears the intent; a later opening cannot reuse it.
Earlier click-anchored interactive captures are not comparable.

Streamed-content captures require `contentFrameProtocol: publisher-frame-v1`.
When the SDK publishes inside an animation frame, the observer can inspect the
committed source watermark in that same rendering opportunity. Deferred commits
retain the normal observation fallback. Both paths timestamp a later task; neither
claims pixel presentation. Old streamed-content captures are incompatible. The
thread-switch-only suite has no streaming scenarios and is unaffected.

Normal-profile budgets allow at most 5% over 100 ms for Send/Stop/menu feedback,
and 50 ms for typing and received-content frames. Relative gates cover load,
first output, server preparation, settlement, and navigation. These are targets,
not claims that the current app passes.

`compare-results.ts` validates schema, sample coverage, correctness, complete
scenario identity (including delivery shape), fixture hash, and matching hardware
and browser. It reports validity/compatibility, relative regression, and absolute
responsiveness targets separately. Strict mode remains the default and fails on
any of these categories. The approved CI regression policy uses the explicit mode:

```sh
bun run benchmarks/chat-performance/browser/compare-results.ts --regression-only path/to/base.json path/to/current.json
```

This mode still fails invalid captures and actual regressions. Unchanged absolute
targets remain visible as PASS/FAIL, but do not control its exit status; a policy
pass does not certify target compliance. PR evidence pairs original main product
code and the candidate on the same runner/browser with identical measurement
hooks, fixtures, and configuration, retaining both revision and build identities.
A valid but slow main reference is allowed for this explicit regression policy.

Missing, invalid, or incompatible baselines fail in both modes; relative regression
is **NOT EVALUATED** when it cannot be established. Explicit `--collect-baseline`
validates first evidence without claiming a relative comparison. Collection is
strict unless `--regression-only` is also supplied. Follow `baselines/README.md`;
old schema-v1 artifacts cannot arm this gate.

Same-repository relevant PRs run the core suite. Standard, durable, and thread-switch
suites run weekly. PRs compare the PR merge base; scheduled and manual runs default
to the checked-out revision's first parent. Manual `comparison_ref` can select a
different ancestor; self-comparison fails. Both builds run in one job, so the
workflow needs no previously stored CPU baseline. Changes to measurement sources
require a reviewed overlay before comparing. Paired artifacts retain `base.json`,
`head.json`, the provenance manifest, instrumentation diff, and comparison report.
Fork PRs receive no credentials. Setup requires the
existing `PERF_ENV_FILE` and `PERF_AUTH_PASSWORD` GitHub secrets and valid reference
captures under the selected policy. Results upload even on failure.

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

Anonymous standard/smoke dispatches have a separate concurrency lane from
credentialed journey runs. Their suite definitions are checked to reject any
authenticated scenario. Each paired comparison still runs sequentially on one
isolated CI machine; authenticated suites remain serialized. This avoids blocking
an authenticated PR comparison behind an unrelated guest rendering capture.
Guest usage admission still reaches the shared deployment under a fresh anonymous
identity; these lanes isolate browser CPU, not backend capacity.
The legacy overlay also accepts descendants of its original reference only when
their existing measurement modules and hook files remain byte-identical to that
reference. After checking and applying the hook patch, the runner copies the
head's measurement modules into the baseline before capture. Unrelated base-branch
commits do not require a new baseline; changed hook layouts still require review.

Late interactions retain the 80% content checkpoint and run typing, native wheel,
then menu opening. The active-stream check follows the measured menu frame;
unmeasured dismissal follows. `late-typing-native-wheel-menu-v2` rejects both
earlier probe ordering and the previous DOM/frame wheel measurement.
