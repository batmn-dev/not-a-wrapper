# Metric dictionary — chat performance

Date: 2026-08-27. This is the naming and interpretation contract for every chat-performance metric —
existing, proxy, and proposed. Phase 3/4 report against these names; nothing may report
under a name not defined here.

**Status update (2026-08-27, Phase 2 landed):** the schema defects are fixed
(`deduped` checkpoint kind accepted; `stream_terminal` reports `abort` after a Stop
intent; `request_parse`/`model_config`/`history_adaptation` now emitted), the
receipt-anchored server spans, provider first-event/first-text spans, transport taps,
Stop mark, rAF-coalescer publication summary, projection/Shiki durations, long-task and
rAF-gap observers, per-op `durable_write` timings, `settlement_total`, and the sampled
Convex-side read/write bucket logs (`CHAT_PERF_CONVEX_SAMPLE_RATE`, `_tag:
"chat_perf_convex"`) all exist. Rows below are annotated individually; `proposed` rows
that remain are harness-derived (Phase 3) or deferred to an experiment.

**Status update (2026-09-01, ADR-0030):** provider timing now has one source — the AI
SDK's per-step `performance` (`timeToFirstOutputMs`, `responseTimeMs`,
`toolExecutionMs`), sampled on a monotonic clock upstream of every
`experimental_transform`. The former `provider_first_event` span was measured in the
SDK chunk callback, which runs AFTER the word-chunking transform, so for the one
smoothing-eligible model (Claude Haiku 4.5) it included this server's own holdback
delay; its rows in the 2026-08-27 baseline are post-transform contaminated for that
model and must not be compared with the re-sourced figure. `provider_first_event` is
retired; `provider_first_output` replaces it; `provider_first_text_delta` moves to the
transport group with its true meaning. The same step figures feed the always-on **Run
timing receipt** on the generation run (group 13) and the user-facing **Generation
stats** on the assistant message.

## Global rules

- **Privacy class — all metrics are `content-free`.** No metric or dimension may carry
  prompts, outputs, tool arguments, attachment names, secrets, user IDs, chat IDs, run
  IDs, or raw trace contents. Enforcement is the schema allow-list +
  `validateChatPerfEvent` (`lib/observability/chat-performance.ts:118-253`), which
  rejects unknown events, unknown fields, enum violations, and secret-shaped strings.
  Sizes and counts are reported as power-of-2 buckets, not exact values, when they could
  correlate with content.
- **Correlation.** Client marks and server spans join on `correlationId` (the per-send
  `x-chat-perf-id` UUID; one-shot, never persisted, never crosses into Convex). Convex
  measurements are statistical (sampled, bucketed) — they never join per-request.
- **Composite metrics must decompose.** No result may report a single combined "TTFT"
  without the component stages that sum to it. `send_to_first_visible_text` is reported
  only alongside its parts (dispatch gap, server prep, provider first-text, transport,
  render).
- **Status legend.** `existing` = emitted today · `proxy` = emitted today but measures a
  stand-in for the named thing (limitation noted) · `proposed` = Phase 2 work.
- **Gate?** = eligible as a CI/benchmark regression gate. Only deterministic,
  provider-free metrics gate. Real-provider metrics are smoke-labeled and never gate.
- Units: durations in `ms` (float), sizes in `bytes` (bucketed where noted), counts
  dimensionless.

## 1. Perceived latency (browser)

| Metric | Start → End | Layer | Gate? | Status |
|---|---|---|---|---|
| `send_to_optimistic_paint` | `chat_send_intent` → `optimistic_message_painted` | browser | yes (deterministic harness) | existing (proxy) |
| `send_to_request_dispatched` | `chat_send_intent` → `request_dispatched` | browser | yes | existing (true fetch mark since Phase 2 — emitted by the transport immediately before the HTTP request) |
| `send_to_first_visible_text` | `chat_send_intent` → `first_visible_text` | browser+server+provider | no (includes provider) | existing (proxy) |
| `input_to_next_paint` | keystroke `event.timeStamp` → next frame (`composer.keystroke_to_next_paint`) | browser | yes | existing |
| `input_to_settled_paint` | keystroke → second frame (`composer.keystroke_to_settled_paint`) | browser | yes | existing |
| `stop_to_ui_feedback` | `stop_intent` → stopped-state render | browser | yes | partial (`stop_intent` mark exists; the feedback endpoint is harness-measured — `stream_terminal` with `outcome: "abort"` bounds it from above) |

Interpretation and limitations:

- `optimistic_message_painted` and `first_visible_text` fire from `useEffect` —
  **commit-time, not paint-time**. Under the deterministic harness the commit→paint gap is
  measured separately (`delta_to_paint`, group 5); a paint-adjacent variant of
  `first_visible_text` is proposed via the rAF-chain technique.
- `request_dispatched` fires from the transport at the actual `fetch()` (Phase 2); the
  old status-transition proxy is gone, so `send_to_request_dispatched` now includes the
  pre-fetch client work (`chat-turn-controller.ts:371-419`) it used to hide.
- `send_to_first_visible_text` includes provider latency; report it only decomposed and
  never compare across providers/models as one population.
- Allowed dimensions: `textLengthBucket` (on `first_visible_text`), scenario, viewport,
  cpuThrottle, warm/cold (harness-supplied, result-file only).

## 2. Server preparation (Next.js) — `server_span` events

All are durations with `ok`, sampled by `CHAT_PERF_SAMPLE_RATE`, joined by
`correlationId`. None include provider latency; all include Convex round-trip latency
where noted, so none are strictly deterministic in production. Under the deterministic
harness (local Convex, fixed fixtures) they gate with generous ceilings.

| Metric (span name) | Measures | Convex I/O inside? | Status |
|---|---|---|---|
| `request_parse` | body `req.json()` + wire-contract validation | no | existing (Phase 2; rejected requests return without a span) |
| `auth_session` | WorkOS session resolution | no (network: WorkOS) | existing |
| `usage_admission` | outer admission block: atomic abuse admission ∥ preflight ∥ key-settings prefetch, then credential resolution. The abuse mutation checks and increments in one round-trip before credential resolution; `attachment_resolution` includes its concurrent window | yes (several) | existing |
| `attachment_resolution` | `planGenerationInput` + trusted-text preflight | yes | existing |
| `credential_resolution` | approval-route facts, key settings, route resolution, **platform usage reservation** | yes | existing |
| `usage_reservation` | `reserveAuthorized` mutation alone | yes | existing (baseline 56.6 ms p50 — effectively all of post-prefetch `credential_resolution`) |
| `model_config` | logical model resolution (pure) | no | existing (Phase 2) |
| `tool_preparation` | 3-layer tool setup + MCP connect | network: MCP | existing |
| `durable_prepare` | execution grant + run creation + history load (`prepareGeneration`) | yes | existing |
| `message_validation` | boundary-1 structural validation | no | existing |
| `history_adaptation` | provider history adaptation | no | existing (Phase 2; the `_tag:"history_adapt"` log keeps its richer warning fields) |
| `model_bound_validation` | boundary-2 validation | no | existing |
| `prepare_total` | whole `turn.prepare()` | yes | existing |
| `stream_start` | runtime-construction → immediately before `streamText` | no | existing — **anchor caveat**: excludes auth/parse/admission; do not sum with them until re-anchored (map §2.3) |
| `provider_request_started` | request receipt → `streamText` call | no | existing (Phase 2; the receipt-anchored companion to `stream_start`) |

Interpretation: `prepare_total` + admission spans + `auth_session` approximate the plan's
"server preparation excluding provider" (working target 250–300 ms p95). Sub-spans are
nested, not additive across groups — never sum overlapping spans.

## 3. Provider latency

| Metric | Start → End | Layer | Gate? | Status |
|---|---|---|---|---|
| `provider_invocation_to_first_output` | provider call start → first output chunk (text, reasoning, tool-input delta, tool call, or file) of step 0 | provider | no (correctness-checked against the deterministic script) | existing (ADR-0030: `server_span` `provider_first_output`, sourced from SDK step performance; Braintrust/Sentry buckets read the same figure) |
| `provider_invocation_to_first_event` | — | — | — | **retired 2026-09-01** (post-transform; see the status note) |

Smoke-suite only; labeled by provider+model+route tier; never a population with other
providers. Dimensions: provider, model, route tier (platform/BYOK), warm/cold credential
path. Reasoning counts as output here, exactly as in the SDK's definition, so a hidden
thinking phase is inside this figure.

## 4. Transport

| Metric | Start → End | Layer | Gate? | Status |
|---|---|---|---|---|
| `server_first_stream_write` | request receipt → first chunk enqueued to the response stream | next | no | existing (Phase 2; sampled requests only — the tap is skipped otherwise) |
| `first_write_to_client_first_bytes` | `server_first_stream_write` → `client_first_stream_bytes` | network | no | proposed (both endpoints now exist; the join is harness-side, cross-machine clocks — report medians only) |
| `client_first_stream_bytes` | fetch dispatch → first parsed response chunk | browser | no | existing (Phase 2; transport tap reads only the chunk `type` discriminant) |
| `client_first_text_delta_received` | fetch dispatch → first text-delta chunk | browser | no | existing (Phase 2) |
| `provider_first_text_delta` | `streamText` call → first text delta RELEASED to the response pipeline (post-transform: smoothing holdback is inside it) | next | no | existing (re-homed from group 3 on 2026-09-01; the name is unchanged, the meaning was always this) |

## 5. Rendering (browser)

| Metric | Definition | Gate? | Status |
|---|---|---|---|
| `delta_to_paint` | text-delta receipt → next painted frame (rAF-chain) | yes (harness) | proposed |
| `first_text_to_visible` | `client_first_text_delta_received` → `first_visible_text` | yes (harness) | proposed (plan target: <50 ms p95 normal CPU) |
| `long_task_count` / `longest_task_ms` / `total_blocking_time_ms` | derived from `long_task` marks (`PerformanceObserver("longtask")`, mounted in instrumentation builds by `useChatResponsivenessMarks`) | yes (harness) | existing (marks; aggregates harness-derived) |
| `raf_gap_p95_ms` | derived from `raf_gap` marks (rAF-interval sampler while streaming, >40 ms gaps) | yes (harness) | existing (marks; aggregates harness-derived) |
| `markdown_projection_ms` | `markdown_projection_advance` mark per committed advance | yes | existing (Phase 2) |
| `markdown_projection_anomalies` | count of `markdown_projection_reset` / `_fallback` / `_settle_mismatch` by `reason` | yes (zero-tolerance on settle_mismatch) | existing |
| `shiki_highlight_ms` / `shiki_invocations` | `shiki_highlight` mark per highlight run (duration includes any lazy grammar/theme load; count = mark count) | yes | existing (Phase 2; a separate grammar-load split stays proposed) |
| `dom_node_count_start` / `_end` | scenario boundaries | yes (harness) | proposed |
| `heap_growth_bytes` | CDP, harness-only | no (advisory) | proposed |

## 6. Streaming pipeline accounting

| Metric | Definition | Gate? | Status |
|---|---|---|---|
| `stream_chunks_received` | SSE frames observed by the client tap | yes | proposed |
| `ui_publications` | rAF-coalescer publications per streaming session | yes | existing (Phase 2: `stream_publication_summary` mark — one per session, emitted when the stream leaves `streaming`) |
| `coalesced_deltas` | SDK message callbacks absorbed without a publication | yes | existing (Phase 2, same summary; "deltas" = SDK message callbacks, not SSE frames) |
| `react_commits` | React commit count — **profiling builds only**, never normal production | yes (profiling harness) | proposed |
| `stream_bytes_total` / `stream_chars_total` | bucketed totals per turn | yes | proposed |

Invariant (plan target): `ui_publications` ≤ one per animation frame during streaming;
status/error publications are exempt (they bypass the coalescer by design).

## 7. Markdown / code (deterministic microbenches — existing `bench:chat`)

| Metric | Source | Gate? | Status |
|---|---|---|---|
| `branch_projection_ms` (575/1,150-row + named + seeded fixtures) | `branch-projection.bench.ts` | yes — 5 ms p95 for the production path in the controlled weekly benchmark lane | existing |
| `markdown_projection_replay_ms` (7 payload shapes × 40 updates) | `markdown-projection.bench.ts` | yes (scaling gates exist) | existing |
| `shiki_full_block_ms` / `shiki_init_ms` | `render-stream.bench.tsx` | yes | existing |
| `projection_hash` / `correctness_hash` | FNV-1a over outputs (`fixtures.ts:54`) | **blocking** — a hash mismatch invalidates the run's perf numbers | existing (payload hashes pinned in `fixtures.test.ts`, Phase 6, 2026-08-28) |

## 8. Convex durability

| Metric | Definition | Layer | Status |
|---|---|---|---|
| `checkpoint.attempt` / `.accepted` / `.deduped` / `.authority_lost` / `.failed` (+ `payloadBytes`) | snapshot write outcomes, Next side | next | existing — `deduped` accepted since Phase 2; invariant: `attempt = accepted + deduped + authority_lost + failed` (source-pinned by test) |
| `checkpoint.final_flush` / `.settlement_receipt_confirmed` / `.settlement_receipt_degraded` | settlement events | next | existing (counts only) |
| `snapshot_write_ms` | per worker-wire write duration by `op` (closed 8-op enum) | next | existing (Phase 2: `durable_write` event; sampled requests only, so the untimed fast path keeps its microtask depth) |
| `final_snapshot_ms` / `terminal_write_ms` | durations inside `settle()` | next | existing via `durable_write` per-op rows (`updateAssistantSnapshot` final flush, `markGenerationRunCompleted`/`markGenerationRunAborted`) |
| `settlement_total_ms` | whole `settle()` — drain + final flush + terminal write | next | existing (Phase 2: `server_span` `settlement_total`) |
| `snapshot_mutation_outcomes` | applied/stale/deduped/lost, Convex side (mirror of the Next counters) | convex | existing (Phase 2: sampled `_tag:"chat_perf_convex"` `snapshot_write` lines with `payloadBytesBucket`) |
| `snapshot_acceptance_ratio` | accepted / attempt per streamed minute | derived | proposed (cost baseline, no target yet) |

## 9. Reactive reads

| Metric | Definition | Layer | Status |
|---|---|---|---|
| `selected_conversation_client` (`selectedCount`, `mappingDurationMs`) | client-side mapping cost + row count per subscription update | browser | existing (note: re-runs mapping to time it; flag-gated) |
| `subscription_updates_per_turn` | count of `getSelectedPath` and `getSelectedRunState` results delivered during one turn | browser | proposed |
| `reactive_result_bytes_bucket` | serialized result size bucket per update | browser | proposed |
| `messages_read_bucket` / `selected_count_bucket` / `parts_bytes_bucket` | per-invocation read cost, sampled, Convex side | convex | existing (Phase 2: `_tag:"chat_perf_convex"` `selected_conversation_read`, gated by `CHAT_PERF_CONVEX_SAMPLE_RATE`; line frequency doubles as the re-execution counter) |
| `query_reexecutions` / `documents_read` / `db_bandwidth` | deployment metrics via Convex dashboard/MCP, recorded per benchmark run | convex | proposed (result-file only, not app logs) |

## 10. Cross-client freshness

| Metric | Start → End | Gate? | Status |
|---|---|---|---|
| `snapshot_accepted_to_second_tab_render` | Next-side `accepted` counter timestamp → second browser context renders the content | no (harness-measured, target <1.5 s p95) | existing (durable suite: harness-stamped checkpoint lines vs a MutationObserver in tab 2; baseline 44 ms median) |
| `reload_to_content` | reload navigation start → authoritative thread content rendered | yes (harness) | partial (`chat_navigation_intent` → `first_thread_content_painted` / `authoritative_thread_content_received` marks exist for sidebar nav; reload variant proposed) |
| `terminal_to_settlement` | `response_stream_closed` → `durable_settlement_receipt` (client observation) | no | existing (durable suite; note the receipt can precede the local stream-close mark by ~10–15 ms — settlement runs server-side in `onEnd` and the Convex projection outruns the SDK status flip) |
| `detached_binding_gauge` | same-tab back-nav binding events (8-value enum, counts) | n/a | existing |

## 11. Correctness (blocking — a failure invalidates all perf numbers from the run)

| Metric | Definition | Status |
|---|---|---|
| `missing_chunks` / `duplicate_chunks` / `reordered_chunks` / `post_terminal_chunks` | violations detected by the stream folder against the deterministic script | existing at fixture level (`foldStreamScript`); proposed at the production-path level (Phase 3 replays through the real transport) |
| `correctness_hash` | FNV-1a hash of folded/rendered output vs fixture expectation | existing (fixture); proposed (harness end-to-end) |
| `snapshot_duplicate_acceptance` | Convex accepts a sequence ≤ `lastSnapshotSequence` | proposed (server rejects today — the metric proves it stays zero) |
| `settle_mismatch_count` | `markdown_projection_settle_mismatch` occurrences | existing (target: zero) |
| `stream_terminal.outcome` fidelity | `abort`/`disconnect` reported truthfully | fixed for `abort` in Phase 2 (Stop intent noted per turn); `disconnect` remains unemitted — the client cannot distinguish it today |

## 12. Cost proxies (baseline-only, no targets yet)

`convex_reads_per_streamed_minute`, `convex_writes_per_streamed_minute`,
`reactive_result_bytes_per_streamed_minute`, `subscription_updates_per_streamed_minute`,
`snapshot_acceptance_ratio`, `provider_duration_ms` + token counts where the provider
reports them (smoke suite only). Sources: Convex deployment metrics + the counters in
groups 8–9, aggregated per scenario in the result file.

## 13. Run timing receipt (always-on, per generation run — ADR-0030)

Stored on the `generationRuns` row (`timingReceipt`) by every terminal write, durable
turns only; mirrored per sampled turn (guest turns included) as the `run_timing_receipt`
perf event, durations only. Every segment is a `performance.now()` difference in the
Next.js process (wall-clock steps cannot corrupt it); every field optional; absent =
unobserved, never zero. Per run — never accumulated across an approval continuation.
A user Stop or supersession lands the stopped worker's partial receipt through the
single-use receipt-attach capability (`attachRunTimingReceipt`, authenticated against
the digest the Stop transaction copied onto the run); a run that dies without any
worker write (reap) has none. Read with `runTiming:timingSummary` (see the runbook).

| Field | Start → End | Owner | Gate? |
|---|---|---|---|
| `prepareMs` | HTTP receipt → provider dispatch (`streamText` call) | us | yes |
| `providerFirstOutputMs` | provider call start → first output chunk, step 0 (SDK); anchored at the call ATTEMPT that succeeded, so SDK retry backoff (default 2 retries) is outside it | provider | no — correctness check |
| `firstWriteDelayMs` | first output chunk → that chunk released to the response stream; same successful-attempt anchor as above | us | yes |
| `modelResponseMs` | Σ per-step provider response time (SDK). Provider-executed (hosted) tools — OpenAI `web_search` and the like — run INSIDE it | provider | no |
| `toolExecutionMs` | Σ per-step CLIENT-side tool execution (SDK); hosted tools contribute nothing | tools | no |
| `wireStreamMs` | first output chunk released → finish part released to the response stream, observed in the UI-stream conversion (post-transform, in SDK order); ends at the finish so it spans the same last-delta → provider-finish tail as `modelResponseMs` | us + provider | via `pacingOverheadMs` |
| `settlementMs` | settle start → terminal write dispatch (drain + final flush) | us | via `settlement_total` |
| `buildId` | short commit identity of the server build | — | dimension |

Derived at read time, never stored:

- `serverTimeToFirstTokenMs = prepareMs + providerFirstOutputMs + firstWriteDelayMs`.
- `pacingOverheadMs = wireStreamMs − (modelResponseMs − providerFirstOutputMs) −
  toolExecutionMs` — what the response pipeline added on top of the provider's own
  output window. Watch this when touching smoothing or the UI-stream conversion.
  Hosted-tool part conversion is inside it (≈100 ms observed on an OpenAI web-search
  turn versus 1–3 ms on plain turns): compare like with like, never a mixed population.

The harness gates `prepareMs`, `firstWriteDelayMs`, `pacingOverheadMs`, and
`settlementTotalMs` (from the span) in `compare-results.ts`; the provider segments are
checked against the deterministic script's scheduled delays and invalidate the run when
they disagree. `timingSummary` reports p50/max per segment and withholds p95 under 20
samples, per the non-metrics rule below; its `model`/`buildId` filters apply before the
scan limit.

**Generation stats (user-facing, message-level — same provider figures):** time to first
token = `providerFirstOutputMs` of the first run's first step; the output window is Σ
per output step of (response − time to first output); **tokens per second = visible
(output − reasoning) tokens ÷ output window**. Providers that hide reasoning (OpenAI)
generate it before the first output chunk, inside time to first token, so counting it
would inflate the rate by exactly the hidden share (live: 271 tokens incl. 128 reasoning
over 1,284 ms read 211 tok/s for text that streamed at 111). Providers that stream
thinking inside the window read conservatively instead — never inflated. Hosted tool
calls are counted (`providerToolCalls`) because their time stays in the window.

## Non-metrics (explicitly out of contract)

- Any single undifferentiated "TTFT" number.
- Wall-clock comparisons across different machines, build classes, or provider
  populations.
- `p95` on sample sets smaller than 20 — report median/max only and say so.
