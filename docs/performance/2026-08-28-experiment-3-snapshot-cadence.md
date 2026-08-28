# Experiment 3 — snapshot cadence

Date: 2026-08-28 · Build: post-layout-fix `.next-perf` (split subscription
default-on) · Knob: `CHAT_SNAPSHOT_THROTTLE_MS` (new; clamped to
[100, 5000], default 750 — the historical write storm ran at ~59 ms and the
clamp keeps a typo from recreating it; read per turn, so a perf server
relaunches at a new cadence without a rebuild).

Three passes over `durable-mixed-30-fixed` + `durable-text-30-second-tab` +
`durable-text-30-reload` (RUNS=5, WARMUPS=1), Convex side captured per pass.
All correctness gates green in all passes.

## Cost — linear in cadence, as predicted

Per pass (~4 min, 18 turns), uncached executions:

| | 750 ms (control) | 500 ms | 250 ms |
|---|---|---|---|
| `updateAssistantSnapshot` | 279 execs, 6.9 MB read / 4.1 MB written | 400, 10.5 / 5.9 | **695, 18.0 / 9.8** |
| `getSelectedPath` re-executions | 366 (5.1 MB read) | 487 (7.0) | 779 (11.0) |
| `getSelectedRunState` | 418 | 540 | 832 |
| snapshot writes per turn (client count) | 15–16 | 22 | 38–39 |

250 ms costs ~2.6× the durable write+read volume of 750 ms, and every
applied beat also re-executes the path query for every subscriber.

## Benefit — not measurable

| p50 | 250 | 500 | 750 |
|---|---|---|---|
| TBT | 4–11 ms | 4–9 ms | 3–6 ms |
| send→first-visible | 517–721 ms | 515–706 ms | 538–732 ms |
| reload→authoritative | 209 ms | 214 ms | 223 ms |
| snapshot→second-tab median (max) | 307 (4,424) ms | 33 (542) ms | 86 (3,059) ms |

Second-tab apply latency is noise-dominated at n=5 — non-monotonic, with
the worst outlier at the fastest cadence. The one genuine improvement is
definitional, not measured: the worst-case content AGE in secondary views
(second tab, reload recovery, adoption-loss fallback) is bounded by the
cadence — 750 ms → 250 ms shrinks that bound by half a second.

## Decision: keep 750 ms

Sub-second staleness in secondary views does not justify 2.6× durable-plane
cost, and no primary-view metric moves at all. The env knob stays for future
experiments. Two forward-looking notes:

1. **Adoptive/adaptive cadence is only interesting because of the
   adoption-loss defect** — when live-stream adoption is lost, the visible
   page paints AT the snapshot cadence, where 750 ms is visibly steppy.
   That argues for fixing adoption loss (already on the TODO), not for
   paying 2.6× on every healthy turn.
2. At faster cadences per-execution mutation time *dropped* (16.4 ms at
   250 vs 23.8 ms at 750) — write cost per beat is not the bottleneck;
   volume is.

## Harness fix shipped alongside

The durable fallback correctness bound measured `document.body.innerText`,
which is layout-aware — after the B1 layout fix, settled off-screen blocks
carry `content-visibility: auto` and were excluded from it, failing every
durable scenario ("rendered only 3181 chars"). The bound now sums the
markdown containers' `textContent` (delivered DOM content, containment-
independent). First observed on this experiment's initial pass; the failure
was the harness's, not the cadence's.
