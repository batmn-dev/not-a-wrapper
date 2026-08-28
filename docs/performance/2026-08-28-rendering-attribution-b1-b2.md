# B1/B2 rendering attribution — layout, not JavaScript

Date: 2026-08-28 · Build: `.next-perf` (instrumented, split flag on — the
flag touches no rendering path) · Tool:
`benchmarks/chat-performance/browser/trace-attribution.ts` (Chrome tracing
over one deterministic guest turn per case; every ≥50 ms main-thread task
attributed by trace-event self-times, joined with the app's own
`chat-perf:*` User Timing marks, which fire inside the tasks that pay for
them — no clock alignment needed).

## Result

| | B1 `long-markdown:100:fixed` | B2 `mixed-markdown:30:fixed` cpu4 |
|---|---|---|
| stream window | 30.2 s | 13.6 s |
| long tasks | 188 (13.4 s, TBT **4.02 s**) | 66 (4.0 s, TBT **0.74 s**) |
| **layout** | **10.4 s (78%)** | **2.2 s (55%)** |
| js | 1.2 s | 1.1 s |
| style (recalc) | 1.2 s | 0.4 s |
| paint | 0.4 s | 0.2 s |
| gc / other | 0.2 s | 0.1 s |
| app-measured projection advances | 0.50 s (502 ms over ~500 advances) | 0.40 s |
| app-measured Shiki | 0.30 s | 0.36 s |

TBT matches the baseline harness numbers (B1 ~3.9 s, B2 ~0.6 s), so the
trace is measuring the same phenomenon the suite reports.

## The layout signature

Across the whole B1 window there are 1,002 `Layout` events totalling
17.9 s (10.4 s of it inside long tasks), mean 17.9 ms each, and:

- **Not forced reflow:** 14 ms of the 17.9 s sits inside `FunctionCall`;
  0 ms inside `FireAnimationFrame`. This is the browser's own frame
  lifecycle re-laying out after each streamed commit — no JS layout-read
  antipattern to fix.
- **Cost scales with accumulated content:** layout ms per 5 s bucket climbs
  1.8 → 3.3 → 3.1 → 3.9 → 4.0 s as the answer grows (B2 shows the same
  ramp). Per-frame layout cost is proportional to how much has already
  streamed, which is exactly why long streams degrade superlinearly.
- **The dirty set is tiny; the work is not:** `dirtyObjects` p50 = 22
  (max 274) against `totalObjects` up to 17,212, yet each pass costs ~18 ms.
  Chrome only *marks* a few objects dirty, but laying out the dirtied block
  means re-running inline/text layout for the whole growing message
  container — one "object" whose internal layout is the entire answer.

What this rules out: markdown projection JS (500 ms, and its per-advance
durations are already capped ~13 ms in these runs), Shiki (300 ms),
React/JS broadly (1.2 s total — second-order), paint, GC, and
IntersectionObserver (78 ms).

## Implication — the next experiment is layout containment

The fix class is CSS/structure, not JS: stop per-beat layout from scaling
with the full accumulated answer.

1. **Contain completed blocks.** The streaming renderer (ADR-0016) already
   splits settled markdown blocks from the growing tail. Completed block
   elements are layout-static; `contain: layout` (or `content-visibility:
   auto` with `contain-intrinsic-size`) on them should cap each beat's
   layout at the tail block's size. Measure with this same trace tool:
   expect the per-5s layout ramp to flatten.
2. **Audit the container chain.** `totalObjects` reaching ~17 K suggests
   layout roots escape the message. Verify the turn/thread containers
   (`contain` style, the eager-arm `content-visibility` on TurnRows) actually
   isolate settled turns while a stream is live in the last turn.
3. **Tail size control.** If a single markdown block can grow unbounded
   (giant paragraph/code fence), containment can't help inside it; the
   renderer's block segmentation is then the lever.

Before/after protocol per the plan: implement one candidate, rerun
`trace-attribution.ts` (layout bucket + ramp) and the standard suite
(`long-markdown-100-fixed`, `mixed-markdown-30-fixed-cpu4`: TBT, projection
settle correctness), on this branch, one change at a time.

Artifacts: `results/traces/*.analysis.json` (per-task buckets, top tasks,
marks-inside); raw traces alongside (gitignored).
