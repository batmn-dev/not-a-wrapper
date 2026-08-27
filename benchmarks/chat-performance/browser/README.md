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

- **Guest path only.** No WorkOS auth in the harness yet, so durable-Convex
  scenarios — cross-tab freshness, reload adoption, snapshot cadence — are
  not covered here; the runbook's manual protocol still owns those. The
  Convex dev deployment is still exercised for guest usage admission.
- Scenarios needing real tools (the fixture `interleaved` script) are not
  replayed; the deterministic provider covers text/reasoning/code/error/stop
  shapes plus the payload stress variants.
- Marks are commit-time (see the measurement map §2.4); paint-truth requires
  a tracing pass, which this harness does not yet drive.
- Warm-state only per scenario context; cold-state (fresh browser context per
  run) is not yet a matrix dimension.
