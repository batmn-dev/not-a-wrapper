# Interaction optimizations, 2026-09-05

This series extends the existing rendering, shared-module, and subscription
patterns without adding dependencies. Product changes below include the history
readiness fix in `8dd091f8`; the observer comparison was captured separately on
`41a1fd0a` and does not measure the later fix.

## Product changes

- Message, Activity, and reasoning Markdown share one Next dynamic boundary.
  Composer focus, pointer, touch, and coarse-pointer visibility warm the renderer
  through the existing deduplicated intent preloader. Send starts warming without
  awaiting it. The SSR-aware renderer remains available for existing content.
- First Send commits the optimistic update synchronously, then animates the live
  composer with the shared 500 ms spring. Browser snapshot capture no longer
  delays that update. Reduced motion skips the animation; the shared View
  Transition helper also bypasses snapshots for reduced motion. Composer sizing
  reuses an identical measurement across the editor transaction and controlled
  commit, invalidating it when the content or sizing inputs change.
- Sidebar menus consume stable chat actions and the reset command independently
  of streaming message data. Memoized rows and menu bodies retain relevant chat,
  active-state, and presentation updates while avoiding unrelated row work.
  Delete dialogs mount on first use and remain mounted for their closing motion.
- Streaming fade ranges walk backward through the live tail. Highlight styles
  are scoped to participating messages, and off-screen tails stop rebuilding
  ranges after existing visible cohorts finish fading. Re-entry resumes current
  cohorts. Cohort updates still read the container's current `textContent`, so
  this does not eliminate all work proportional to answer length.
- Markdown skips child preparation in the render that adjusts its projection
  state. React immediately retries that render before reconciling children. A
  focused test verifies one growing-tail preparation instead of two, with the
  same stable paragraph node and rendered text; this is not a latency claim.
- Existing-chat Send waits for the message provider's history readiness, the
  selected stream binding, and loaded history reaching the rendered message
  array. The same guard protects direct and automatic submission. Typing and
  Stop remain available; a new chat's first send bypasses existing-history
  readiness. Delivered query-cache data needs no extra fetch. This prevents a
  follow-up from sending an empty or another chat's selected-path token.

## Earlier asset and correctness evidence

The initial asset comparison used instrumented production builds in the same
worktree/environment and localhost homepage HTML without an authenticated
browser. Declared script URLs were fetched and recompressed with Node's default
Brotli settings:

| Initial HTML script assets | Before | After |
| --- | ---: | ---: |
| Count | 34 | 33 |
| Decoded bytes | 3,974,960 | 3,512,691 |
| Locally Brotli-compressed bytes | 1,000,962 | 887,168 |

That initial declared set was 113,794 compressed bytes smaller (11.4%). This is a
historical comparison of the shared Markdown boundary, not a measurement of the
final deployed transfer size or all bytes fetched after hydration and intent.
The ignored `asset-smoke-{before,after}.json` files retain those captures.

The earlier 1,000-paragraph fade fixture took 1,004 TreeWalker steps before the
backward-tail change and fewer than eight afterward with identical highlighted
text. Later review and hosted runs found additional correctness gaps; the early
review was not a final clean bill of health. Fixes addressed observer attribution,
Stop settlement evidence, and existing-history readiness. Focused checks at
`8dd091f8` pass 77 tests across the core, real AI SDK seam, Composer, and message
provider. Removing the binding guard makes the cached A-to-B automatic-submit
test fail with chat B carrying chat A's token; restoring it sends B's token.

## Scoped observer comparison

The hosted observer comparison used commit
`41a1fd0af66f46fdeb55e346cf749e3509aead8a`, build
`MKZlcDBXGKBH7A7GYF6qy`, Chromium `151.0.7922.34`, and a Linux x64 runner with
four logical CPUs on an AMD EPYC 7763. The viewport was 1440 × 900 with no CPU
throttle. Both arms used the same instrumented production build and the
`long-markdown:100:fixed` fixture, with a fresh guest and browser context for
every sample. One warmup pair was discarded; five measured pairs alternated
observer-on/off order. All accepted arms passed foreground, observer-state,
stream-oracle, and native-input checks.

Native scheduler intervals overlapping Send through terminal were clipped and
unioned independently of the DOM observer. The median paired incremental
main-thread work was **+49.228 ms (+0.191%)**, over approximately 25.8 seconds of
main-thread work per arm. The paired diagnostic input and blocking figures were:

| Pair | Main-thread work change | Keydown median, off → on (ms) | Reported TBT, off → on (ms) |
| --- | ---: | ---: | ---: |
| 1 | −0.092% | 37.35 → 36.63 | 167.3 → 157.6 |
| 2 | +0.191% | 46.19 → 36.15 | 139.8 → 169.5 |
| 3 | +0.169% | 43.65 → 32.98 | 152.7 → 142.5 |
| 4 | +0.624% | 36.42 → 35.14 | 161.3 → 169.7 |
| 5 | +0.624% | 32.04 → 31.08 | 155.2 → 119.8 |

Each arm captured eight native keydown entries. These are individual event
latencies, not logical interaction maxima or INP. Reported TBT sums the portions
above 50 ms of long tasks starting inside the window; unlike the unioned work
metric, that diagnostic does not include a task starting before Send. Pairwise
variation does not establish a typing speedup or prove that instrumentation adds
no tasks longer than 50 ms.

This comparison measures incremental benchmark DOM-observer cost during that
single streaming workload. It excludes startup and production telemetry reporting
and does not establish overall production overhead or a user-facing latency win.
Only content-free aggregates are recorded here; raw traces remain diagnostic
artifacts and are not committed.

Replay was active during these captures. PostHog recorder callbacks consumed
699–742 ms per measured arm, so variable background work is material relative to
the 49 ms median observer difference. Subsequent benchmark builds explicitly
disable Sentry and PostHog replay and require `replayPolicy: disabled-v1` in their
results. These earlier captures cannot seed that environment's baseline. Normal
production replay configuration is unchanged; the controlled benchmark excludes
replay cost and does not replace production responsiveness monitoring.

## Rendering control

[Run 33952533695](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33952533695)
compared the existing Smooth and Quick preferences on commit `fada0203`, build
`rb0WBXwvqQCf2B1F7o0se`, Chromium `151.0.7922.34`, Intel Xeon Platinum 8573C
(four logical CPUs), and the same B1 fixture. Both fresh-guest captures disabled
replay and held the DOM observer configuration constant. Full-window native
layout work was 9,513 ms with Smooth and 9,507 ms with Quick; main-thread work
was 24,552 and 23,926 ms respectively. Both passed the complete stream oracle.
This one-pair diagnostic rules out the fade as the dominant layout cost in that
capture. It does not establish a release speedup or identify the remaining cause.

The subsequent invalidation trace from [run 33953389166](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33953389166)
recorded 60,373 subtree invalidations across 497 nodes from the calendar's global
`nth-child(2)` descendant selector. Unchanged Markdown headings and paragraphs
were repeatedly removed from and added to layout. The calendar is not mounted
in this fixture. Its first-day rule now uses the adjacent week-number row header
instead. That trace exhausted its buffer before the terminal marker, so it is
root-cause evidence only; it cannot provide whole-window timing or certification.
The normal rendering probe omits this high-volume optional trace category.

[Run 33955151948](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33955151948)
at `2d36aa43`, on AMD EPYC 7763 with the same browser and fixture, measured
10,331 ms layout work with Smooth and 10,732 ms with Quick (25,102 and 24,917 ms
main-thread work). Both complete stream oracles passed. This runner differs from
the earlier Intel Xeon Platinum 8573C control; their absolute totals are not
comparable and cannot attribute a speedup or regression to the calendar correction.
Within this capture, layout remains a substantial part of main-thread work.

The standard capture also exposed a visibility-observer error: an initial scan
at zero opacity did not rescan during the finite Markdown reveal animation, so
sparse slabs could be attributed to the following slab, roughly 3.4 seconds later.
`dom-frame-v3` follows the first visible animation frame and rejects older
measurement captures. Setup now uses the same explicit 40 ms typing cadence as
the interaction probes, recorded in environment metadata, avoiding incomparable
zero-delay automation bursts. Neither change alters feedback budgets or product
animations.

## Rejected containment control

[Run 33956973113](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33956973113)
compared Smooth, Quick, and Smooth with diagnostic inline-size containment on
one AMD EPYC 7763 runner, commit `d41971ff`, build `lZJLyEeEsI8g-2XTfKLJk`, and
Chromium `151.0.7922.34`. All three passed the complete stream oracle and ended
with identical Markdown and scroll geometry. Smooth layout work was 10,398 ms;
containment measured 10,353 ms, a 0.43% difference in one capture. Main-thread
work changed from 25,506 to 25,219 ms while TBT increased from 154 to 169 ms.
This does not establish a meaningful improvement, so containment was not applied.
A global `.markdown` rule would also affect shared-page user bubbles whose width
depends on their content, outside the full-width assistant surface tested here.

[Run 33958747562](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33958747562)
then compared the inner flex containers with diagnostic `display: flow-root` on
commit `eac0bbcf`, build `KBE4b-OR0Tiau0v1veNcE`, AMD EPYC 7763, and the same
Chromium version. Smooth layout was 11,430 ms versus 11,053 ms with the control;
main-thread work was 24,755 versus 24,445 ms, while TBT increased from 136 to
175 ms. Markdown height changed by 16 px and scroll height by 20 px. All stream
oracles passed, but this single capture neither establishes a useful improvement
nor preserves geometry. No product layout change was applied.

## Render subscriptions and observation accuracy

The transient route-handoff flag now has a narrow context subscription. Ordinary
chat-session consumers skip the adoption-only notification after chat identity
stabilizes, and `ChatInner` skips unchanged parent renders. Thirty-nine focused
tests preserve route rollback, Back navigation, model selection, and reasoning
effort. A mutation check restoring the broad notification makes the isolation test
fail. This proves avoided renders; latency improvement requires the hosted run.

The shared Composer now skips unchanged parent renders. Its Send callback forwards
to the latest committed implementation, preserving that invocation's controller
and history throughout asynchronous acceptance. A retained-callback test crosses
chat A to chat B and verifies B's history, version, and controller are used. Local
draft and Stop changes still update; 61 focused tests pass. Hosted measurements
must establish any latency benefit.

A further observer audit found that native menus open on mousedown, before the old
click anchor. Menu timing now starts at primary pointerdown or keyboard opening
intent, and closing/cancelling clears it. Interactive captures require
`menuProtocol: activation-v1`; production menu distributions carry the same tag.
A delayed-click test proves the opening work remains included, and 69 observer
tests pass. Earlier interactive results cannot seed the corrected menu protocol.

The observer can run before the SDK publisher in one animation-frame batch.
A guarded publisher callback now inspects confirmed content in that same
rendering opportunity, avoiding an otherwise unnecessary additional frame.
Deferred commits keep the ordinary fallback. Streamed-content results require
`contentFrameProtocol: publisher-frame-v1`; older captures cannot seed this
protocol. This is a measurement correction, not a product speedup. A fresh
observer-overhead control and full captures remain necessary.

## Remaining validation

Local authenticated-browser checks were blocked by the locked Mac during the
earlier asset work. Hosted browser execution has since supplied the scoped
comparison above and exposed failures in the full journey capture. The latest full responsiveness capture passes all seven journey correctness
checks, including follow-up and constrained scrolling. Absolute latency budgets
still fail, so this is not release certification.
A reviewed thread-switch baseline from run 33958084155 contains 90 valid
switches. Median navigation is 45–48 ms; p95 is 601–829 ms, with the long
Markdown fixture accounting for every sample above 150 ms. Those samples are
retained. An independent normal comparison remains required. Runner-matched
responsiveness, standard, and durable baselines remain pending.
For the short-chat fixture cohort in that capture:

| Pass | Samples | Median | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Unvisited click | 17 | 47.2 ms | omitted | 95.4 ms |
| Unvisited hover | 18 | 47.1 ms | omitted | 74.8 ms |
| Visited | 43 | 42.8 ms | 63.8 ms | 72.0 ms |

The cohort is selected by fixture identity and deterministic traversal order,
not by removing slow observations. Below 20 samples, p95 is omitted. These
synthetic cohorts do not establish a real-user population percentile. Rendering
a long destination is part of navigation responsiveness, so the combined gate
continues to include those slower switches.

Production DOM/frame reporting remains opt-in with
`NEXT_PUBLIC_CHAT_UI_SAMPLE_RATE` defaulting to `0`. Unit tests and this observer
comparison do not certify release responsiveness.
