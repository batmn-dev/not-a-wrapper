# System performance baseline — 2026-08-27

Phase 4 deliverable of the performance benchmarking plan. Contract:
[`metric-dictionary.md`](./metric-dictionary.md) · lifecycle inventory:
[`current-measurement-map.md`](./current-measurement-map.md) · harness:
`benchmarks/chat-performance/browser/` (results file
`results/2026-08-27T20-55-52-standard.json`, local).

**This report ends at the mandatory review checkpoint (§6). No optimization
experiment has been implemented; per the plan none may be until this report is
reviewed.**

## 1. Provenance

| Field | Value |
|---|---|
| Git commit | `111b586e` (branch `darknight/strange-apparitions`) |
| Production build | `.next-perf` BUILD_ID `HZnVB3d8oqDtm1bGKjyKj`, built with `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION=true` |
| Build class | production (`next build` + `next start`; never dev mode) |
| Fixture identity | branch-projection hashes `4a062f446ff7b783` (575-row) / `28eda0330f8c4e4e` (1,150-row) — byte-identical to the pinned 2026-07-22 baseline; ~12 KB scenario oracle hash `f42a045150755c72` |
| Machine | Apple M4 Max, 16 cores, 64 GB RAM, Darwin 25.5.0 (the controlled benchmark machine for all numbers below) |
| Browser | Chromium 151.0.7922.34 (Playwright), desktop 1440×900 and mobile 390×844 viewports, CPU 1× and 4× (CDP throttle) |
| Runtime (microbench) | Node v25.8.1 via vitest bench |
| Convex deployment class | dev deployment (guest usage-admission traffic only) |
| Provider | deterministic scripted provider (`CHAT_PERF_DETERMINISTIC_PROVIDER=1`) — **no real-provider smoke suite was run for this baseline**; provider-latency metrics here measure the scripted stream, i.e. app overhead only |
| Samples | browser: 10 measured runs after 2 warmups per scenario; microbench: vitest bench sample counts as printed (5–30) |
| Warm/cold | browser context warm per scenario, fresh guest identity per run (storage cleared + reload); server process warm across a scenario |
| Instrumentation | enabled everywhere (client marks + `CHAT_PERF_SAMPLE_RATE=1`); overhead A/B vs an uninstrumented build **not yet measured** — owed before instrumentation numbers are treated as user-facing truth |
| Correctness | all 11 scenarios passed the blocking checks: SSE fold hash == oracle hash (prefix rule for stop; outcome rule for error), expected terminal outcome, zero `markdown_projection_settle_mismatch` |

Known environmental caveats: the user's dev server was idle-resident on port
3000 during the runs (machine not fully quiescent); p95 over 10 runs is
indicative, not statistically strong — treat p50/max as the stable columns.

## 2. Browser suite (deterministic provider, guest path)

All times ms. `send→visible` = `chat_send_intent` → `first_visible_text`
(commit-time). `txt→vis` = first text-delta chunk at the transport →
first visible text. TBT = Σ(long task − 50 ms) over the run.

| Scenario | send→visible p50/p95 | send→optimistic p50/p95 | dispatch→first chunk p50 | txt→vis p50/p95 | TBT p50/max | LT max (max) | proj max p95 | publications p50 | coalesced p50 | DOM growth p50 |
|---|---|---|---|---|---|---|---|---|---|---|
| text-only 30cps fixed | 248 / 316 | 89 / 115 | 86 | 15 / 16 | 5 / 8 | 58 | 19 | 288 | 3 | 1,498 |
| mixed-markdown 30 fixed | 465 / 652 | 91 / 125 | 84 | 12 / 17 | 5 / 7 | 57 | 16 | 294 | 5 | 1,505 |
| code-block 30 fixed | 247 / 576 | 83 / 99 | 84 | 14 / 15 | 39 / 41 | 91 | 9 | 309 | 3 | 3,284 |
| long-markdown 100 fixed (~100 KB) | 222 / 262 | 90 / 114 | 90 | 12 / 16 | **3,916 / 4,044** | 110 | 85 | 797 | 1,630 | 11,396 |
| code-stress 30 fixed (1,600 lines) | 246 / 266 | 98 / 111 | 83 | 13 / 16 | 198 / 230 | 143 | 17 | 1,240 | 3 | 12,882 |
| mixed-markdown 100 bursty | 208 / 266 | 85 / 125 | 80 | 12 / 16 | 6 / 9 | 59 | 14 | 30 | 269 | 1,505 |
| mixed-markdown 30 slab | 3,876 / 3,923 | 86 / 114 | 85 | 50 / 56 | 26 / 31 | 75 | 18 | 10 | 5 | 1,505 |
| mixed-markdown 30 fixed, mobile | 453 / 495 | 84 / 108 | 83 | 13 / 17 | 6 / 7 | 57 | 20 | 294 | 5 | 1,505 |
| mixed-markdown 30 fixed, CPU 4× | 548 / 770 | 155 / 164 | 119 | 35 / 42 | 571 / 684 | 220 | 37 | 254 | 46 | 1,505 |
| partial-error 30 fixed | 235 / 267 | 83 / 104 | 78 | 13 / 17 | 0 / 0 | 0 | 4 | 96 | 2 | 511 |
| stop-during-text 10 fixed | 274 / 276 | 56 / 60 | 79 | 13 / 15 | 0 / 0 | 0 | 5 | 12 | 1 | 75 |

Reading notes:

- **mixed-markdown's higher send→visible (~465 vs ~248) is reasoning time**: the
  scenario streams ~280 ms of reasoning deltas before text
  (`provider_first_text_delta` 280 ms vs `provider_first_event` 1 ms) — the
  first-event/first-text separation working exactly as designed.
- **The slab row's 3.9 s send→visible is a delivery-shape property, not an app
  defect**: a ~4 KB slab arrives when its last constituent delta would have
  (by harness construction), so nothing renderable exists for ~3.4 s. Its
  txt→vis (50 ms) is the app's actual share.
- `coalesced` > `publications` on long-markdown-100 shows the rAF coalescer
  absorbing more than half the SDK callbacks under load — and TBT is still
  ~4 s, so the per-frame commit cost, not publication frequency, is the
  limiting factor there.
- The stop row: `stop_intent` → `stream_terminal` p50 **5.8 ms** (p95 5.3–6).

## 3. Server spans (mixed-markdown 30 fixed, median of 10 sampled runs)

Guest path; receipt-anchored where noted. All Convex round-trips are to the
dev deployment.

| Span | Median ms |
|---|---|
| `usage_admission` (abuse check + increment, 2 sequential Convex round-trips) | **67.4** |
| `provider_request_started` (receipt → streamText) | 68.5 |
| `server_first_stream_write` (receipt → first chunk enqueued) | 70.5 |
| `prepare_total` | 0.76 |
| `tool_preparation` | 0.12 |
| `request_parse` / `auth_session` / `model_config` / `credential_resolution` / `message_validation` / `model_bound_validation` / `history_adaptation` / `durable_prepare` | ≤ 0.1 each |
| `provider_first_event` (streamText → first scripted chunk) | 1.0 |
| `provider_first_text_delta` (streamText → first text delta; scenario streams reasoning first) | 280 |
| `response_stream_closed` (receipt → close) | 13,596 |

The receipt→provider-start timeline is therefore ~68 ms, of which ~67 ms is
`usage_admission` — everything else on the guest prepare path is sub-millisecond.
The authenticated/platform path (credential resolution with allowance
reservation, durable prepare with history load) was **not exercised** by this
harness and its spans here are trivially small; treat those columns as
unmeasured, not fast.

## 4. Deterministic microbenchmarks (`bun run bench:chat`, same machine)

- **Branch projection (single-pass context, production implementation):**
  1,150-row tree mean 0.43 ms (max 0.47 ms); 575-row 0.23 ms; 200-tree seeded
  sweep 3.9 ms total. The env-gated 5 ms p95 gate (`CHAT_PERF_GATES=true`)
  passes. The retired per-call-adapters implementation measures 86 ms on the
  1,150-row tree — the gate protects a ~200× regression margin.
- **Markdown incremental projection (×40 tail-growth replay):** ~12 KB mixed
  16.2 ms vs legacy 341 ms; ~100 KB 14.6 ms vs 3,381 ms (the incremental
  projection is size-invariant on append); 400 short blocks 7.8 ms; growing
  fence 0.25 ms. **Known degenerate shape:** one very long paragraph — 207 ms,
  identical to the legacy splitter (≈5 ms per update at settled size; no safe
  restart boundary inside a paragraph).
- **Shiki:** highlighter init 65.7 ms; settled 400-line block 15.5 ms;
  the per-delta re-highlight pathology the idle window prevents would cost
  356 ms per replay.
- **React render (jsdom `renderToString` reference):** settled 12 KB payload
  32.6 ms; 10 growth states without memo reuse 178 ms.

## 5. Thresholds vs. plan targets

| Target | Result |
|---|---|
| 1,150-row branch projection < 5 ms p95 | **PASS** (0.47 ms max; gate green) |
| First text delta received → visible paint < 50 ms p95, normal CPU | **PASS** (p95 15–17 ms; commit-time proxy) — CPU 4×: 42 ms; slab: 56 ms |
| Composer input → next paint < 50 ms p95 | **captured but not aggregated** (`composer.keystroke_*` marks fire during harness typing; summarizer column owed) |
| Standard streaming scenario: no >50 ms long task | **FAIL (baseline recorded)** — text/mixed max ≈ 57–59 ms; code 91 ms; stress cases 110–220 ms |
| ≤ 1 UI publication per animation frame | **PASS** (publications ≤ frames in every scenario; coalescer absorbs the excess — 1,630 coalesced on long-markdown) |
| Stop → local UI feedback < 100 ms | **PASS** (stop→terminal-mark p50 5.8 ms) |
| Accepted snapshot → second-tab display < 1.5 s p95 | **NOT MEASURED** (guest-only harness; durable plane needs authenticated scenarios) |
| Terminal → durable settlement < 1.5 s p95 | **NOT MEASURED** (same reason; `settlement_total` span now exists for when it is) |
| Server preparation excluding provider < 250–300 ms p95 | **PASS for guests** (~68 ms, admission-dominated); authenticated path unmeasured |
| Duplicate / reordered / post-terminal chunks | **ZERO** (byte-level fold hash matched the oracle on every completed run) |
| Snapshot duplicate acceptance | **NOT EXERCISED** (no durable snapshots on the guest path) |
| Instrumentation overhead < 2 % median | **NOT YET MEASURED** (needs an uninstrumented `.next-perf` A/B) |

Cost-proxy baselines (Convex reads/writes/bandwidth per streamed minute,
snapshot acceptance ratio): **not captured** — they require durable
(authenticated) scenarios plus `CHAT_PERF_CONVEX_SAMPLE_RATE` set on the
deployment. The instrumentation exists; the harness lacks an auth path.

## 6. Mandatory review checkpoint — five largest measured bottlenecks

**Stop point.** Per the plan, no optimization experiment proceeds until this
section is reviewed.

### B1. Long/stress streams block the main thread for seconds
- **Evidence:** long-markdown-100: TBT p50 3,916 ms over a ~26 s stream, long
  tasks to 110 ms, single projection advances to 85 ms, DOM +11,396 nodes;
  code-stress: TBT 198 ms, tasks to 143 ms. Microbench corroboration: the
  one-very-long-paragraph projection shape costs ≈5 ms per update and is
  size-proportional (207 ms/40 updates), and growing-table advances cost
  36 ms/replay.
- **Ownership:** internal (rendering: projection degenerate shapes + per-frame
  React commit + decay overlay; exact split not yet attributed).
- **User impact:** visible jank/freezes on long answers; scroll and input
  starvation during the worst seconds.
- **Proposed experiment:** attribute TBT between projection, commit, and
  overlay via a profiling-build run; then attack the top contributor (e.g.
  paragraph-interior restart boundary, or skip-frame publication when the
  previous commit overran).
- **Correctness risk:** medium — projection changes touch the ADR-0016
  equivalence contract; the corpus + settle-mismatch gates cover it.
- **Convex cost impact:** none.

### B2. 4× CPU turns an ordinary answer into ~0.6 s of blocking
- **Evidence:** mixed-markdown-30 at CPU 4×: TBT p50 571 ms, long tasks to
  220 ms, txt→vis p95 42 ms (vs 17 ms at 1×); coalesced jumps 5 → 46.
- **Ownership:** internal (same machinery as B1 at lower headroom).
- **User impact:** mid-tier phones/laptops feel every streamed answer.
- **Proposed experiment:** same attribution as B1; the coalescer already
  halves commits under load — evaluate commit-budget-aware frame skipping.
- **Correctness risk:** low-medium (presentation cadence only; ADR-0015's
  "bounded cost" gate applies).
- **Convex cost impact:** none.

### B3. Send → optimistic paint costs ~85–90 ms
- **Evidence:** p50 83–98 ms across scenarios (p95 to 164 ms on CPU 4×);
  the stop scenario — a shorter prior DOM — shows 56 ms, so the cost scales
  with mount/flip work, not typing.
- **Ownership:** internal (client submit path: optimistic attachment mapping,
  onboarding→thread flip, first commit of the thread surface).
- **User impact:** every single send feels ~90 ms less immediate than it
  could; this is the floor under all perceived-latency numbers.
- **Proposed experiment:** React-profiler pass over `submit()` →
  `setMessages` → first thread commit; target < 50 ms p95.
- **Correctness risk:** low (presentation path), but the composer
  tree-position seam (immediate-send TBC variant) is delicate — its tests
  gate.
- **Convex cost impact:** none.

### B4. Usage admission is the entire guest server-prep cost (~67 ms)
- **Evidence:** §3 — `usage_admission` 67.4 ms of the 68.5 ms
  receipt→provider-start; two sequential Convex round-trips (abuse
  `checkUsage` query, then `incrementUsage` mutation) with everything else
  ≤ 0.1 ms.
- **Ownership:** internal sequencing + Convex network RTT.
- **User impact:** ~70 ms added to time-to-first-token on every turn (and the
  authenticated path stacks credential resolution + reservation + durable
  prepare on top — unmeasured, see the gap below).
- **Proposed experiment:** plan Experiment 1 — overlap the increment with
  prepare (it is not an admission decision), or collapse check+increment into
  one mutation; measure the authenticated path first so the experiment
  optimizes the real shape.
- **Correctness risk:** medium — admission ordering is load-bearing (ADR-0021
  reservation arming, abuse-limit semantics); no weakening of authorization.
- **Convex cost impact:** fewer function calls per turn (cost down).

### B5. The durable/reactive plane is still unmeasured — and is the known cost amplifier
- **Evidence:** static (measurement-map §2.6–2.7): `getSelectedConversation`
  collects every message with full parts and re-delivers the whole selected
  path on every 750 ms checkpoint; the run-doc patch invalidates it even for
  deduped content; snapshot dedupe runs a double `JSON.stringify` per beat.
  No runtime numbers exist because the harness has no authenticated session.
- **Ownership:** internal (Convex schema/query design).
- **User impact:** cross-tab/reload freshness cost, browser commit load from
  full-array re-delivery, and the dominant Convex bandwidth bill.
- **Proposed experiment:** first close the measurement gap (harness auth — a
  WorkOS test session or storage-state injection — plus
  `CHAT_PERF_CONVEX_SAMPLE_RATE` on the dev deployment); then plan
  Experiment 2 (split-query prototype) with the cost-proxy baselines §5 owes.
- **Correctness risk:** high if rushed — branch/sibling semantics and
  mixed-snapshot tearing are the documented hazards; version-gated reads are
  mandatory in any split design.
- **Convex cost impact:** the largest available win.

### Explicitly not bottlenecks (measured healthy)
Branch projection (0.4 ms at 2× today's largest fixture), guest prepare
outside admission (< 1 ms), Stop feedback (6 ms), transport first-chunk
delivery (~80 ms including server prep), publication discipline (rAF-aligned
with working coalescing), 12 KB-class streams on normal CPU (TBT ≤ 8 ms).

---

## 7. Addendum (same day, post-review): the durable plane measured — B5 closed

The checkpoint was reviewed and the B5 measurement gap closed first, as
recommended. New apparatus: a real WorkOS test user
(`benchmarks/chat-performance/browser/ensure-auth-user.ts`, provisioned via
the WorkOS API with a verified email; real `/auth/login` once per harness run,
storage-state reuse), a `SUITE=durable` scenario set (complete, second-tab,
reload-mid-stream, durable Stop), and `CHAT_PERF_CONVEX_SAMPLE_RATE=1` on the
dev deployment. Result file `results/2026-08-27T23-45-14-durable.json`
(4 scenarios × 10 runs after 2 warmups, all correctness green; deterministic
provider; platform-funded turns settle at the scripted 10-in/5-out token
usage, so allowance burn is negligible).

### 7.1 Authenticated turn timeline (mixed-markdown 30cps, p50 of 10)

| Stage | Durable | Guest (§3) |
|---|---|---|
| `usage_admission` (incl. credential resolution + reservation) | **234.7 ms** | 67.4 ms |
| · `credential_resolution` (key settings, approval facts, `reserveAuthorized`) | 114.9 ms | 0.04 ms |
| `durable_prepare` (grant + run + history) | 69.0 ms | ~0 |
| `prepare_total` | 173.8 ms | 0.76 ms |
| `provider_request_started` (receipt → streamText) | **405 ms** | 68.5 ms |
| client dispatch → first stream chunk | 436.9 ms | 84 ms |
| send → first visible text | 828.7 ms | 465.3 ms |
| send → optimistic paint | 121.7 ms | 90.5 ms |
| `settlement_total` (drain + final flush + terminal write) | 276.5 ms | n/a |
| snapshot writes per turn / mean round-trip | 16 × 64.6 ms | n/a |

**B4 restated with the real numbers: the authenticated pre-stream pipeline is
~405 ms — 6× the guest path — all of it sequential Convex/WorkOS round-trips**
(abuse check, key settings, approval facts, allowance reservation, increment,
grant + run creation). This is Experiment 1's before-picture. Perceived send →
first visible text on a durable chat is ~830 ms before any provider latency
would even apply.

### 7.2 Durability targets — all previously unmeasured rows now PASS

| Target | Result |
|---|---|
| Accepted snapshot → second-tab display < 1.5 s p95 | **PASS** — median 44 ms, per-run max p95 193 ms (MutationObserver on the second tab vs harness-stamped accepted checkpoints) |
| Terminal → durable settlement < 1.5 s p95 | **PASS** — `settlement_total` 276–295 ms p50; the client-side receipt lands **before** the local stream-close mark by ~12–14 ms on complete runs (settlement runs server-side in `onEnd`, and the Convex projection outruns the SDK's status flip); durable Stop: receipt +88 ms after terminal |
| Reload-mid-stream recovery | reload → authoritative content **213 ms** p50; reload → settlement receipt ≈ 8.1 s (that is stream remainder — the run keeps streaming server-side — not recovery latency) |
| Stop → terminal (durable, mutation path) | 7.6 ms p50 |
| Snapshot duplicate acceptance | zero (all writes `applied`, none `stale`/`lost` in the sampled Convex logs) |

### 7.3 Cost proxies (Convex `usageStats`, spot window inside one streaming turn, single subscriber)

| Function | Rate | Per execution |
|---|---|---|
| `getSelectedConversation` re-executions | **~116/min while streaming** (≈2/s — the message patch AND the run patch each invalidate it per beat) | ~23 KB read, 6 docs, 19 ms |
| `updateAssistantSnapshot` | ~80/min (750 ms cadence) | ~35 KB read + ~20 KB written, 16 ms |
| `markGenerationRunCompleted` | 1/turn | 53 KB read, 30 KB written |

≈ **2.7 MB/min query reads + 2.8 MB/min mutation reads + 1.6 MB/min writes per
streaming turn with one subscriber**, growing with answer length (the query
re-delivers the full selected path each execution). Each additional
tab/subscriber adds its own full re-delivery. This is B5's Experiment 2
before-picture, now with runtime numbers.

### 7.4 New product finding: intermittent live-stream adoption loss

In 3 observed runs (2/10 in the recorded reload scenario plus one in an
earlier discarded run), the durable send's hard navigation to `/c/<chatId>`
lost live-stream adoption: the turn ran and settled server-side and content
rendered correctly — but only via the 750 ms snapshot plane
(`first_chunk_received`/`first_visible_text`/`stream_terminal` never fired
while the transport tap and settlement receipt did). Users would see a
correct but visibly chunky answer with no error. The harness now counts this
per scenario (`liveStreamNotAdoptedRuns`); worth a dedicated investigation
alongside (not inside) Experiment 1. Related: the hard navigation itself is
why durable `send → optimistic paint` (~122 ms) and the guest→durable
dispatch gap are elevated — and it also flushes Chromium's network buffer,
which is why durable correctness uses settlement-based rules when the SSE
body is unreadable.
