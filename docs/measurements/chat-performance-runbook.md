# Chat-performance measurement runbook (PR 0b)

How to take comparable, content-free chat-responsiveness measurements. The
benchmark half (branch/Markdown/Shiki, PR 0a) is covered by
`2026-07-22-chat-performance-baseline.md`; this runbook covers live
browser/server measurement.

> **Status note (2026-07-23).** The verified PR 1/2/3/7b behavior is now
> unconditional. Only the diagnostic instrumentation switches below remain;
> see `2026-07-23-flag-collapse.md`.

## Instrumentation switches (all default OFF)

| Switch | Side | Effect |
| --- | --- | --- |
| `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION=true` | client (build-time) | User Timing marks (`chat-perf:*`) for turn + navigation events, selected-conversation mapping counters, detached-binding gauges. Changing it requires a rebuild/redeploy. |
| `CHAT_PERF_SAMPLE_RATE=<0..1>` | Next server (deploy-time) | Per-request sampling of `_tag:"chat_perf"` structured log lines: preparation spans and checkpoint counters. Start staging at `1`, production at `0.05`, reduce if overhead is measurable. |

Correlation: when the client flag is on, each send mints a UUID, stamps its
own marks, and sends it once as `x-chat-perf-id`; the route validates it and
carries it through sampled spans. It is never persisted to any document and
never reused across turns. Raw traces that contain page text stay local —
never attach them to public issues.

## Build classes (do not conflate — plan PR 0 step 3)

1. **Normal production build** (`bun run build:next && bun run start`): the
   only class eligible for user-traffic sampling. All marks above work here.
2. **Production-optimized profiling build** (local/staging only): needed for
   React `<Profiler>` commit counts/durations and React performance tracks.
   React strips Profiler in ordinary production bundles; enable it by setting
   `reactProductionProfiling: true` in `next.config.ts` for the measurement
   build only (this repo intentionally does not ship that in its committed
   config — see AGENTS.md's config-change gate). The profiling build adds
   overhead and is never deployed as the ordinary production artifact; no
   normal-production telemetry may depend on Profiler availability.

## Standard measurement protocol

- Build: production (`next build`), never `next dev`.
- CPU: record both normal and Chrome DevTools 4× CPU slowdown runs.
- Viewport: desktop (default window) and a representative mobile viewport
  (~390×844); record which.
- Cache state: record warm vs cold for Shiki highlighter, server module
  imports, and the Convex subscription (fresh tab vs revisited chat).
- Scenarios: drive the deterministic stream matrix where possible — success,
  Stop (during reasoning/text/tool), approval + continuation, partial error,
  reload during generation, navigation away/return, guest chat.
- Chunk rates: compare 10/30/100 chunks/second shapes (the PR 0a stream
  fixture defines the reference cadences).

## Reading the data

- Client: DevTools Performance panel → User Timings track (`chat-perf:*`),
  or `performance.getEntriesByType("mark")` in the console. Turn latency
  metrics are the deltas defined in plan §7.4 (e.g. `chat_send_intent` →
  `first_visible_text`).
- Server: filter logs for `"_tag":"chat_perf"`; join a single turn on
  `correlationId`. `stream_start` durationMs is request-to-provider-start.
- Checkpoints: `event:"checkpoint"` kinds `attempt/accepted/authority_lost/
  failed/final_flush/settlement_receipt_*` with cumulative `payloadBytes`.

## Trace export naming

`traces/<yyyy-mm-dd>-<scenario>-<build>-<cpu>-<viewport>[-<variant>].json`
e.g. `traces/2026-07-22-code-heavy-prod-4x-mobile-flag-off.json`. Record the
`[chat-performance] environment:` JSON (or equivalent machine facts) next to
every stored trace. Traces stay local.

## Overhead acceptance (before any production sampling)

Compare an instrumentation-off and instrumentation-on trace of the same
deterministic scenario: overhead must be below trace noise and introduce no
new >50 ms long task (plan PR 0 acceptance). If it fails, reduce
`CHAT_PERF_SAMPLE_RATE` or move the offending mark off the hot path first.

## Rollout seam

Flag capabilities for later phases are fixed by
`docs/chat-performance-rollout-seam.md`: build/deploy-time env flags with a
deployment-wide local → staging → production flag-on progression. The active
seam has no percentage cohorts, live kill switch, or remote weights.
