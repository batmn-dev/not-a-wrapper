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

## Remaining validation

Local authenticated-browser checks were blocked by the locked Mac during the
earlier asset work. Hosted browser execution has since supplied the scoped
comparison above and exposed failures in the full journey capture. Hosted journey
diagnostics are ongoing, including follow-up and constrained interaction checks.
Runner-matched responsiveness, standard, durable, and thread-switch baselines
remain pending.
Production DOM/frame reporting remains opt-in with
`NEXT_PUBLIC_CHAT_UI_SAMPLE_RATE` defaulting to `0`. Unit tests and this observer
comparison do not certify release responsiveness.
