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
server spans. Aggregates are p50/p75/p95/max — treat p95 as indicative only
at the default sample size.

**Correctness gates every number**: the captured SSE stream is folded and
hash-compared against the scenario oracle (prefix rule for stopped streams,
which may not expose a body), the terminal outcome must match, and any
`markdown_projection_settle_mismatch` fails the scenario. A correctness
failure exits non-zero and the timings must be discarded.

## Scope and known limitations

- **Durable scenarios: `SUITE=durable`.** The harness provisions a WorkOS
  test user via the API (`ensure-auth-user.ts`; override with
  `PERF_AUTH_EMAIL`/`PERF_AUTH_PASSWORD`), signs in once through the real
  `/auth/login` form, and reuses the storage state. Durable runs measure
  settlement, per-op worker-write durations, second-tab freshness, and
  reload recovery. Two durable caveats: the hard navigation to `/c/<chatId>`
  flushes Chromium's network buffer, so correctness falls back to
  settlement-outcome + settle-mismatch + rendered-length rules when the SSE
  body is unreadable (byte fidelity is proven by the guest suite); and runs
  that lose live-stream adoption (a real, intermittent product behavior) are
  counted per scenario as `liveStreamNotAdoptedRuns` rather than failed.
  Convex-side cost sampling needs `CHAT_PERF_CONVEX_SAMPLE_RATE` set on the
  deployment.
- Scenarios needing real tools (the fixture `interleaved` script) are not
  replayed; the deterministic provider covers text/reasoning/code/error/stop
  shapes plus the payload stress variants.
- Marks are commit-time (see the measurement map §2.4); paint-truth requires
  a tracing pass, which this harness does not yet drive.
- Warm-state only per scenario context; cold-state (fresh browser context per
  run) is not yet a matrix dimension.
