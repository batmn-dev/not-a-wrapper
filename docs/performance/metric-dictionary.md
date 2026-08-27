# Metric dictionary — chat performance

Date: 2026-08-27 · Companion to [`current-measurement-map.md`](./current-measurement-map.md).
This is the naming and interpretation contract for every chat-performance metric —
existing, proxy, and proposed. Phase 2 implements the `proposed` rows; Phase 3/4 report
against these names; nothing may report under a name not defined here.

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
| `send_to_request_dispatched` | `chat_send_intent` → `request_dispatched` | browser | yes | proxy |
| `send_to_first_visible_text` | `chat_send_intent` → `first_visible_text` | browser+server+provider | no (includes provider) | existing (proxy) |
| `input_to_next_paint` | keystroke `event.timeStamp` → next frame (`composer.keystroke_to_next_paint`) | browser | yes | existing |
| `input_to_settled_paint` | keystroke → second frame (`composer.keystroke_to_settled_paint`) | browser | yes | existing |
| `stop_to_ui_feedback` | `stop_intent` → `stop_ui_feedback` | browser | yes | proposed |

Interpretation and limitations:

- `optimistic_message_painted` and `first_visible_text` fire from `useEffect` —
  **commit-time, not paint-time**. Under the deterministic harness the commit→paint gap is
  measured separately (`delta_to_paint`, group 5); a paint-adjacent variant of
  `first_visible_text` is proposed via the rAF-chain technique.
- `request_dispatched` is today the AI SDK `status→"submitted"` transition, not the
  `fetch()` call; Phase 2 moves it into the transport. Until then
  `send_to_request_dispatched` under-reports the pre-fetch client work
  (`chat-turn-controller.ts:371-419`).
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
| `request_parse` | body `req.json()` + wire-contract validation | no | proposed (declared, never emitted) |
| `auth_session` | WorkOS session resolution | no (network: WorkOS) | existing |
| `usage_admission` | outer admission block: abuse check, preflight, credential resolution, usage increment | yes (several) | existing |
| `attachment_resolution` | `planGenerationInput` + trusted-text preflight | yes | existing |
| `credential_resolution` | approval-route facts, key settings, route resolution, **platform usage reservation** | yes | existing |
| `usage_reservation` | `reserveAuthorized` mutation alone | yes | proposed (today folded into `credential_resolution`, not separable) |
| `model_config` | logical model resolution (pure) | no | proposed (declared, never emitted) |
| `tool_preparation` | 3-layer tool setup + MCP connect | network: MCP | existing |
| `durable_prepare` | execution grant + run creation + history load (`prepareGeneration`) | yes | existing |
| `message_validation` | boundary-1 structural validation | no | existing |
| `history_adaptation` | provider history adaptation | no | proposed (exists as `_tag:"history_adapt"` log, promote to span) |
| `model_bound_validation` | boundary-2 validation | no | existing |
| `prepare_total` | whole `turn.prepare()` | yes | existing |
| `stream_start` | runtime-construction → immediately before `streamText` | no | existing — **anchor caveat**: excludes auth/parse/admission; do not sum with them until re-anchored (map §2.3) |
| `provider_request_started` | request receipt → `streamText` call | no | proposed (receipt-anchored replacement) |

Interpretation: `prepare_total` + admission spans + `auth_session` approximate the plan's
"server preparation excluding provider" (working target 250–300 ms p95). Sub-spans are
nested, not additive across groups — never sum overlapping spans.

## 3. Provider latency

| Metric | Start → End | Layer | Gate? | Status |
|---|---|---|---|---|
| `provider_invocation_to_first_event` | `streamText` call → first chunk of any type | provider | no | proxy (`firstChunkLatencyMs` → Braintrust/Sentry buckets only; promote to `chat_perf` with `chunkType` dimension) |
| `provider_invocation_to_first_text` | `streamText` call → first `text-delta` chunk | provider | no | proposed |

Reasoning, source, and tool events can precede visible text — the two metrics are kept
separate deliberately. Smoke-suite only; labeled by provider+model+route tier; never a
population with other providers. Dimensions: provider, model, route tier (platform/BYOK),
warm/cold credential path.

## 4. Transport

| Metric | Start → End | Layer | Gate? | Status |
|---|---|---|---|---|
| `server_first_stream_write` | request receipt → first chunk enqueued to the response stream | next | no | proposed (TransformStream tap) |
| `first_write_to_client_first_bytes` | `server_first_stream_write` → `client_first_stream_bytes` | network | no | proposed (needs both taps + clock-skew note: computed per-turn from the correlationId join, cross-machine clocks — report medians only) |
| `client_first_stream_bytes` | fetch dispatch → first response-body chunk | browser | no | proposed |
| `client_first_text_delta_received` | fetch dispatch → first text-delta SSE frame (envelope type only) | browser | no | proposed |

## 5. Rendering (browser)

| Metric | Definition | Gate? | Status |
|---|---|---|---|
| `delta_to_paint` | text-delta receipt → next painted frame (rAF-chain) | yes (harness) | proposed |
| `first_text_to_visible` | `client_first_text_delta_received` → `first_visible_text` | yes (harness) | proposed (plan target: <50 ms p95 normal CPU) |
| `long_task_count` / `longest_task_ms` / `total_blocking_time_ms` | `PerformanceObserver("longtask")` during a scenario window | yes (harness) | proposed |
| `raf_gap_p95_ms` | rAF-interval sampler during streaming | yes (harness) | proposed |
| `markdown_projection_ms` | duration of `advanceMarkdownProjection` per update | yes | proposed |
| `markdown_projection_anomalies` | count of `markdown_projection_reset` / `_fallback` / `_settle_mismatch` by `reason` | yes (zero-tolerance on settle_mismatch) | existing |
| `shiki_highlight_ms` / `shiki_invocations` / `shiki_grammar_load_ms` | around `highlightCode` | yes | proposed |
| `dom_node_count_start` / `_end` | scenario boundaries | yes (harness) | proposed |
| `heap_growth_bytes` | CDP, harness-only | no (advisory) | proposed |

## 6. Streaming pipeline accounting

| Metric | Definition | Gate? | Status |
|---|---|---|---|
| `stream_chunks_received` | SSE frames observed by the client tap | yes | proposed |
| `ui_publications` | rAF-coalescer publications per scenario | yes | proposed (counter in `message-throttle.ts` — highest-value single insertion point) |
| `coalesced_deltas` | deltas absorbed without a publication | yes | proposed |
| `react_commits` | React commit count — **profiling builds only**, never normal production | yes (profiling harness) | proposed |
| `stream_bytes_total` / `stream_chars_total` | bucketed totals per turn | yes | proposed |

Invariant (plan target): `ui_publications` ≤ one per animation frame during streaming;
status/error publications are exempt (they bypass the coalescer by design).

## 7. Markdown / code (deterministic microbenches — existing `bench:chat`)

| Metric | Source | Gate? | Status |
|---|---|---|---|
| `branch_projection_ms` (575/1,150-row + named + seeded fixtures) | `branch-projection.bench.ts` | yes — 5 ms p95 gate exists, env-gated `CHAT_PERF_GATES=true` (nothing sets it; Phase 6 wires it) | existing |
| `markdown_projection_replay_ms` (7 payload shapes × 40 updates) | `markdown-projection.bench.ts` | yes (scaling gates exist) | existing |
| `shiki_full_block_ms` / `shiki_init_ms` | `render-stream.bench.tsx` | yes | existing |
| `projection_hash` / `correctness_hash` | FNV-1a over outputs (`fixtures.ts:54`) | **blocking** — a hash mismatch invalidates the run's perf numbers | existing (hashes printed, not pinned — Phase 6 pins them) |

## 8. Convex durability

| Metric | Definition | Layer | Status |
|---|---|---|---|
| `checkpoint.attempt` / `.accepted` / `.deduped` / `.authority_lost` / `.failed` (+ `payloadBytes`) | snapshot write outcomes, Next side | next | existing — **`deduped` currently dropped by the enum (defect, fix first)**; invariant after fix: `attempt = accepted + deduped + authority_lost + failed` |
| `checkpoint.final_flush` / `.settlement_receipt_confirmed` / `.settlement_receipt_degraded` | settlement events | next | existing (counts only) |
| `snapshot_write_ms` | per worker-wire write duration (snapshot/step/approval/heartbeat/terminal, by `op` dimension) | next | proposed |
| `final_snapshot_ms` / `terminal_write_ms` / `settlement_total_ms` | durations inside `settle()` | next | proposed |
| `snapshot_mutation_outcomes` | applied/stale/deduped/lost counters, Convex side (mirror of the Next counters) | convex | proposed |
| `snapshot_acceptance_ratio` | accepted / attempt per streamed minute | derived | proposed (cost baseline, no target yet) |

## 9. Reactive reads

| Metric | Definition | Layer | Status |
|---|---|---|---|
| `selected_conversation_client` (`selectedCount`, `mappingDurationMs`) | client-side mapping cost + row count per subscription update | browser | existing (note: re-runs mapping to time it; flag-gated) |
| `subscription_updates_per_turn` | count of `getSelectedConversation` results delivered during one turn | browser | proposed |
| `reactive_result_bytes_bucket` | serialized result size bucket per update | browser | proposed |
| `messages_read_bucket` / `selected_count_bucket` / `parts_bytes_bucket` | per-invocation read cost, sampled, Convex side | convex | proposed |
| `query_reexecutions` / `documents_read` / `db_bandwidth` | deployment metrics via Convex dashboard/MCP, recorded per benchmark run | convex | proposed (result-file only, not app logs) |

## 10. Cross-client freshness

| Metric | Start → End | Gate? | Status |
|---|---|---|---|
| `snapshot_accepted_to_second_tab_render` | Next-side `accepted` counter timestamp → second browser context renders the content | no (harness-measured, target <1.5 s p95) | proposed (Phase 3 two-context harness; there is no adoption code path — this measures the reactive plane end to end) |
| `reload_to_content` | reload navigation start → authoritative thread content rendered | yes (harness) | partial (`chat_navigation_intent` → `first_thread_content_painted` / `authoritative_thread_content_received` marks exist for sidebar nav; reload variant proposed) |
| `terminal_to_settlement` | `response_stream_closed` → `durable_settlement_receipt` (client observation) | no | partial (endpoints exist; requires §4.1 fixes to be trustworthy) |
| `detached_binding_gauge` | same-tab back-nav binding events (8-value enum, counts) | n/a | existing |

## 11. Correctness (blocking — a failure invalidates all perf numbers from the run)

| Metric | Definition | Status |
|---|---|---|
| `missing_chunks` / `duplicate_chunks` / `reordered_chunks` / `post_terminal_chunks` | violations detected by the stream folder against the deterministic script | existing at fixture level (`foldStreamScript`); proposed at the production-path level (Phase 3 replays through the real transport) |
| `correctness_hash` | FNV-1a hash of folded/rendered output vs fixture expectation | existing (fixture); proposed (harness end-to-end) |
| `snapshot_duplicate_acceptance` | Convex accepts a sequence ≤ `lastSnapshotSequence` | proposed (server rejects today — the metric proves it stays zero) |
| `settle_mismatch_count` | `markdown_projection_settle_mismatch` occurrences | existing (target: zero) |
| `stream_terminal.outcome` fidelity | `abort`/`disconnect` reported truthfully | defect today (collapses to finish/error) — fix in §4.1 of the map |

## 12. Cost proxies (baseline-only, no targets yet)

`convex_reads_per_streamed_minute`, `convex_writes_per_streamed_minute`,
`reactive_result_bytes_per_streamed_minute`, `subscription_updates_per_streamed_minute`,
`snapshot_acceptance_ratio`, `provider_duration_ms` + token counts where the provider
reports them (smoke suite only). Sources: Convex deployment metrics + the counters in
groups 8–9, aggregated per scenario in the result file.

## Non-metrics (explicitly out of contract)

- Any single undifferentiated "TTFT" number.
- Wall-clock comparisons across different machines, build classes, or provider
  populations.
- `p95` on sample sets smaller than 20 — report median/max only and say so.
