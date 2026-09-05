# Interaction optimizations, 2026-09-05

This branch improves key chat journeys using existing rendering, loading, and
subscription patterns. It adds no dependencies. Results below retain their source
revision: historical or diagnostic success is not final-source certification.
Raw captures remain in linked CI artifacts rather than committed snapshots.

## Product changes

- Share the exact SSR-aware Next dynamic Markdown loader across message,
  Activity, reasoning, and intent warming. Send warms without awaiting it.
- Commit optimistic Send feedback synchronously, then animate the composer
  using the existing spring. Preserve reduced motion and shared behavior.
- Reuse unchanged composer sizing; subscribe sidebar menus to stable actions;
  memoize unchanged rows and mount deletion dialogs on first use.
- Walk streaming fade ranges backward through the live tail and stop rebuilding
  offscreen ranges after visible cohorts finish. Re-entry resumes current cohorts.
- Skip Markdown child preparation in discarded projection renders and reuse
  eligible context-free parsed blocks, with canonical fallbacks (ADR-0038).
- Scope Activity and keyboard-focus state to relevant elements, removing broad
  style invalidation while retaining focus-visible and interaction behavior.
- Require account/history/stream readiness before existing-chat submission,
  including automatic sends. Keep typing, Stop, and new-chat first sends available.
- Give tooltips 150 ms initial hover intent; preserve immediate keyboard help,
  adjacent-tooltip discovery, and cancellation on quick clicks.
- Disable PostHog document scroll-depth analytics globally. Its capturing scroll
  listeners read document geometry during nested chat scrolling. The original-main
  measurement overlay retains the old setting so this optimization is measured.

## Controlled standard comparison

[Run 33969080296](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33969080296)
compared original main `af97141b` with candidate `30f83a45` on the same AMD EPYC
7763 runner and Chromium 151.0.7922.34, with identical measurement code and
fixtures. Each arm has 55 correct measured runs across eleven scenarios, with no
hidden, dropped, or pending observations. Validity and relative regression gates
pass; absolute targets fail. Independent review verified the raw results.

| Measurement | Original main | Candidate |
| --- | ---: | ---: |
| Normal-CPU Send samples above 100 ms | 46/50 | 0/50 |
| Long-answer content-frame median | 41.7 ms | 17.5 ms |
| Long-answer total blocking time median | 671 ms | 224 ms |
| CPU4 mixed-content frame median | 120.8 ms | 29.1 ms |
| CPU4 mixed-content blocking time median | 5,772 ms | 1,015 ms |
| Stop feedback median | 67.4 ms | 27.3 ms |
| Large Markdown slab frame median | 97.5 ms | 64.9 ms |

All 15 slab samples exceed 50 ms. Partial-error samples exceed 50 ms in 4/60
cases (6.67%, allowed 5%). Some navigation-ready medians increased 24–45 ms,
within relative gates. This is not universal improvement or target compliance.
This capture predates the PostHog change and remains historical evidence.

## Core comparison and scroll diagnosis

[Run 33973783097](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33973783097)
at `25e606eb` completed seven scenarios with five correct runs per arm. Validity
passed but relative regression failed: constrained scroll median 217→674.1 ms,
prepare 284.27→442.06 ms, and settlement 307.98→640.5 ms. Every candidate
scroll sample exceeded every baseline sample. Backend timings may include shared
service variance; this possibility does not waive the failed gate.

[Diagnostic run 33975439192](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33975439192)
profiled one constrained interaction at `25e606eb`. PostHog ScrollManager forced
54.24 ms of style recalculation and 6.316 ms of layout during scroll-end handling.
Other work and delayed input delivery also contributed; disabling analytics is
not yet proof that the whole regression is fixed. A fresh normal comparison must
pass before release. A successful diagnostic is not performance certification.

[Run 33977091454](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33977091454)
at `e29c9fa8` also failed the old relative gate: constrained scroll proxy
192.7→491.8 ms and visible Send enablement increased about 300 ms. Typing fell
821.7→53.9 ms and total blocking time 16,443→2,952 ms. These are mixed results.

The approved correction retains the account safety guard and reports raw button
enablement separately from simultaneous account-and-button readiness. Both arms
observe the same predicate without changing the original product's Send behavior.

[Run 33987016632](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33987016632)
at `52e3f8c3` has 35 correct measured runs per arm. Its generation-to-presentation
scroll gate failed (196.668→404.925 ms constrained). Native stages exposed CDP's
pre-forward visual-state barrier: the median total sample spent 20.978 ms there
in the baseline versus 365.417 ms in the candidate. This automation delay is not
proof of equivalent physical-wheel latency (ADR-0037).

Reanalysis of all 20 measured scroll traces gives browser-forwarding-to-presentation
medians of 181.824→39.508 ms constrained and 75.487→75.807 ms normal. The
candidate's 717.790 ms constrained outlier remains. The corrected protocol gates
that browser interval with the same thresholds and retains both automation delay
and total as diagnostics; raw components must add up. This reanalysis is separate
from final-head capture certification. Late probes retain the 80% checkpoint,
eight keys at 40 ms, native wheel, and one menu click while streaming. Final-head
validity and regression checks remain required.

## Correctness, observer overhead, and retained heap

At `d3400af7`, 144 focused Markdown/projection tests passed. Independent review
compared 5,978 eligible blocks across 5,418 parse windows with canonical ASTs,
including positions, with zero remaining mismatches. Definition-carrier and
overlapping-span cases fall back. This proves semantics and skipped work, not
latency. The `8ed2237d` slab median of 65 ms versus an earlier 78.5 ms includes
intervening CSS changes and cannot isolate syntax reuse (ADR-0038).

The observer on/off comparison at `41a1fd0a` used five alternating measured pairs
on AMD EPYC 7763, Chromium 151.0.7922.34, with identical production build and
long-Markdown fixture. Native scheduler intervals were clipped and unioned from
Send through terminal, independently of the observer. Median incremental
main-thread work was +49.228 ms (+0.191%) over approximately 25.8 seconds per
arm. This scoped result is not a final-product overhead or pixel-presentation claim.

[Run 33966180716](https://github.com/darknightdesigner/not-a-wrapper/actions/runs/33966180716)
at `905f042f` passed its independent exact-environment thread-switch comparison
against `7026cbad`: 90 correct switches on AMD EPYC 9V74 / Chromium 151.0.7922.34.
Unvisited-click/hover/visited medians were 54.6/48.8/45.3 ms; p95 values were
774.4/799.9/562.3 ms. Long-destination tails remain. Unvisited means no prior
navigation in that document, not a forced cache miss; ordinary intent warming
remains enabled.

Successful forced GC was recorded at every 0/10/25/50-switch checkpoint:
25.253/26.012/38.970/27.125 MiB. The mounted long answer accounts for checkpoint
25; checkpoints 10 and 50 show the same short chat. This bounded workload is not
leak proof, nor a causal comparison with older GC-unverified heap readings.

The earlier full local suite passed 2,882 tests across 284 files, with one
controlled timing test reserved for CI. The scroll-setting change passes current
typecheck, focused lint, and 44 comparator tests. Independent review confirms the
legacy overlay preserves original scroll analytics and identical measurement
bootstrap. Applicable final-head CI and core performance checks remain required.

Production DOM sampling defaults to zero. Benchmarks disable replay in both arms;
normal production replay behavior is preserved. Named DOM/frame measurements are
presentation proxies, not INP or exact pixel timing. See ADR-0037 and the metric
dictionary for validity, relative-regression, and absolute-target policy.
