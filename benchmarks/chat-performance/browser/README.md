# Browser benchmark harness

Deterministic production-browser benchmark for the chat surface (measurement
plan Phase 3). Drives the real app — server prepare, streamText transforms,
UI-message conversion, rendering, markdown projection, Shiki, guest
persistence — with the model call replaced by the deterministic scripted
provider (`app/api/chat/deterministic-provider.ts`), and emits one versioned
JSON result file per run under `results/` (gitignored; curate summaries into
`docs/performance/`).

## Running

```bash
# 1. One-time (or after any code change): build the instrumented perf bundle.
#    Isolated dist dir — never touches the dev server's .next.
NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION=true NEXT_DIST_DIR=.next-perf bun run build:next

# 2. Run the standard suite (spawns `next start` on PERF_PORT, default 3111).
bun run bench:browser
```

Env knobs: `SUITE=standard|smoke` · `RUNS` (default 10) · `WARMUPS` (default
2) · `PERF_PORT` (default 3111) · `BASE_URL` (reuse an already-running perf
server; the server-span join is then unavailable) · `PW_CHANNEL=chrome` (use
installed Chrome instead of a downloaded Chromium).

The spawned server runs with `CHAT_PERF_DETERMINISTIC_PROVIDER=1` (the
server-side gate for the scripted provider — a client message alone can never
activate it) and `CHAT_PERF_SAMPLE_RATE=1`, whose `_tag:"chat_perf"` lines
the harness joins to each run by correlation id.

## What a run measures

Per scenario × (RUNS after WARMUPS): mark-derived intervals (send →
optimistic paint / dispatch / first chunk / first visible text, stream
duration, stop → terminal), responsiveness (long tasks, TBT, rAF gaps),
rendering cost (projection advances, Shiki), publication accounting
(callbacks vs publications vs coalesced), DOM/heap growth, and the sampled
server spans. Aggregates are n/p50/p75/p95/max — treat p95 as indicative only
at the default sample size. `n` 0 means no run produced the metric; the
percentiles are then 0 and `compare-results.ts` treats the metric as absent.

**Correctness gates every number**: the captured SSE stream is folded and
hash-compared against the scenario oracle (prefix rule for stopped streams,
which may not expose a body), the terminal outcome must match, and any
`markdown_projection_settle_mismatch` fails the scenario. A correctness
failure exits non-zero and the timings must be discarded.

## CI (Phase 6)

`.github/workflows/perf-benchmark.yml` runs weekly and on demand
(`workflow_dispatch`, suite choice): micro-benchmark timing gates
for branch and Markdown projection, the browser suite (correctness-blocking
via this harness's exit code), and `compare-results.ts` against the checked-in
runner-class baseline in `baselines/` (report-only until a baseline is
committed; see `baselines/README.md`). One-time setup: the `PERF_ENV_FILE`
secret with the perf server's `.env.local` contents, plus a dedicated
`PERF_AUTH_PASSWORD` secret for durable runs. Per-PR CI is untouched —
`bun run test` already covers branch semantics, Markdown projection
correctness, and pinned fixture payload hashes.

## Scope and known limitations

- **Durable scenarios: `SUITE=durable`.** The harness provisions a WorkOS
  test user via the API (`ensure-auth-user.ts`; `PERF_AUTH_PASSWORD` is
  required and `PERF_AUTH_EMAIL` can override the default identity), signs in
  once through the real `/auth/login` form, and reuses the storage state. Durable runs measure
  settlement, per-op worker-write durations, second-tab freshness, and
  reload recovery. Two durable caveats: the hard navigation to `/c/<chatId>`
  flushes Chromium's network buffer, so correctness falls back to
  settlement-outcome + settle-mismatch + rendered-length rules when the SSE
  body is unreadable (byte fidelity is proven by the guest suite); and runs
  that lose live-stream adoption are counted per scenario as
  `liveStreamNotAdoptedRuns` AND fail the scenario — since the 2026-08-28
  layout-owned-Chat fix (see
  `docs/performance/2026-08-28-adoption-loss-root-cause.md`) the expected
  count is 0, and any recurrence is a regression.
  Convex-side cost sampling needs `CHAT_PERF_CONVEX_SAMPLE_RATE` set on the
  deployment. The `durable-text-30-paused` scenario (shape `paused`: four
  fixed-cadence segments split by three 20 s zero-delta gaps) exercises the
  live-run-no-content event class behind ADR-0027's split subscription —
  ~70 s wall clock per run, so trim `RUNS` when iterating; measure the
  Convex side by capturing `bunx convex logs --success --jsonl` around the
  run.
- Scenarios needing real tools (the fixture `interleaved` script) are not
  replayed; the deterministic provider covers text/reasoning/code/error/stop
  shapes plus the payload stress variants.
- Marks are commit-time (see the measurement map §2.4); paint-truth requires
  a tracing pass, which this harness does not yet drive.
- Warm-state only per scenario context; cold-state (fresh browser context per
  run) is not yet a matrix dimension.
