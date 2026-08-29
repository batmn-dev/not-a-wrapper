# Current measurement map — chat turn lifecycle

Date: 2026-08-27 · Commit audited: `1a323f2b` · Status: Phase 1 deliverable of the
performance benchmarking plan. This document records what instrumentation exists
**today**, stage by stage, and where the gaps are. The companion contract is
[`metric-dictionary.md`](./metric-dictionary.md). No behavior was changed to produce
this document.

Conventions used below:

- **Mark** = a browser `performance.mark("chat-perf:<event>")` (User Timing). All client
  marks are gated on the build-time flag `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION === "true"`
  (`lib/observability/chat-performance.ts:30`).
- **Span** = a server-side `server_span` event with `durationMs`, emitted as one
  `console.log(JSON.stringify({ _tag: "chat_perf", ... }))` line
  (`lib/observability/chat-performance.ts:300-307`), sampled by `CHAT_PERF_SAMPLE_RATE`
  (default `0`).
- **Counter** = a server-side `checkpoint` event (`kind` + optional `payloadBytes`), same
  wire, no duration field.
- **Env** = where the measurement executes: `browser`, `next` (Next.js server), `provider`
  (model provider), `convex`.
- **Det?** = whether the measured quantity is deterministic given fixed inputs (i.e. free
  of external network/provider variance).
- **Ext?** = whether the measured interval includes external provider/network latency.

There is **no `performance.measure()` anywhere in the repo** — only marks. Every
client-side interval must be reconstructed downstream from mark pairs. There is **zero
instrumentation of any kind inside Convex functions** — no `chat_perf` events, no timing,
no row/byte counters (`convex/messages.ts`, `convex/chatRuntime.ts` snapshot/terminal
mutations, `convex/chatRuntimeWorker.ts` all have no perf logging). The correlation ID
never crosses the Convex worker wire (`convex/http.ts:203-235` accepts `{ op, args }`
only), so a Next-side `chat_perf` line cannot be joined to any Convex function log.

## 1. Corrections to prior assumptions

The plan and older docs carry a few statements that no longer match the code. Recording
them here so future phases don't design against stale premises:

1. **The message throttle is not a 50 ms timer.** `lib/chat-performance/message-throttle.ts`
   is a `requestAnimationFrame`-aligned coalescer (`subscribeToFrameAlignedMessages`,
   `:18`): while `chat.status === "streaming"`, at most one publication per rAF; status
   transitions, errors, and non-streaming writes publish synchronously. The 50/16 ms
   timer throttles were replaced (rationale: `app/components/chat/use-frame-aligned-chat.ts:13-18`;
   ADR-0016 §"Notification cadence"). The plan's "one normal publication per animation
   frame" target is therefore already the *implemented mechanism* — what's missing is a
   counter proving it holds.
2. **There is no `next.config` flag injection.** `next.config.ts` contains no `env`
   block. `NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE` and the throttle flag were deleted in
   the 2026-07-23 flag collapse; both behaviors are unconditional. The only switches are
   `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION` (client, build-time) and
   `CHAT_PERF_SAMPLE_RATE` (server, deploy-time).
3. **"Second-tab adoption" is not a code path.** The detach/adopt/readopt binding
   (`app/components/chat/use-detachable-chat-stream.ts:215+`) is a per-tab in-memory map
   covering same-tab back-navigation only. A second tab or a reload renders whatever the
   750 ms durable snapshots deliver through `getSelectedConversation`. Cross-client
   freshness must therefore be measured as *snapshot-accepted → other-tab render*, not as
   a binding hand-off.
4. **`lib/chat-performance/streaming-code-render.ts` contains no logic** — it exports one
   constant (`GROWING_HIGHLIGHT_IDLE_MS = 150`); the behavior lives in
   `components/ui/code-block.tsx`.
5. **`docs/measurements/` is gitignored for new files** (`.gitignore:85-89`). Curated
   reports the plan wants committed (the Phase 4 baseline, per-experiment before/after
   reports) must live under `docs/performance/` instead. Raw traces stay local or in the
   sibling `reference-ui` repo, as the runbook already prescribes.

## 2. Lifecycle stage map

Stage order is the real execution order at `1a323f2b`. Server prepare stages run
**strictly sequentially** — there is no `Promise.all` anywhere in `route.ts` /
`chat-turn-runtime.ts` / the durable prepare path (the only `Promise.allSettled` is the
settlement drain, `app/api/chat/durable-turn-runtime.ts:648`).

### 2.1 Send side (browser)

| Stage | Existing metric | Kind | Env | Det? | Ext? | Source |
|---|---|---|---|---|---|---|
| Composer click / key | — none — | | browser | yes | no | `app/components/chat-input/composer.tsx:451` |
| Send intent | `chat_send_intent` mark | start | browser | yes | no | `lib/observability/chat-performance-client.ts:36`, called `app/components/chat/use-chat-core.ts:779` |
| Optimistic row insert | — none at the insert — | | browser | yes | no | `lib/chat-turn/chat-turn-controller.ts:339` |
| Optimistic paint | `optimistic_message_painted` mark | completion (proxy) | browser | yes | no | `chat-performance-client.ts:177` |
| Pre-fetch async work (resolve user, limits check, `ensureChatExists`, attach staged files) | — none — | | browser+network | no | yes | `chat-turn-controller.ts:371-419` |
| HTTP dispatch (`fetch`) | `request_dispatched` mark | start (proxy) | browser | no | no | `chat-performance-client.ts:157` |

Caveats:

- `chat_send_intent` fires *after* the optimistic-attachment mapping loop
  (`use-chat-core.ts:763-775`); the DOM event → JS-entry hop is unmeasured.
- `optimistic_message_painted` is a `useEffect` keyed on `lastUserMessageId` — **commit
  time, not paint time**, and one commit after the actual `setMessages`.
- `request_dispatched` is derived from the AI SDK `status → "submitted"` transition, not
  from the `fetch()` call. Between `chat_send_intent` and the real POST sit four
  un-instrumented awaits (auth resolution, rate-limit check, chat creation, attachment
  binding) — a real network-dependent gap currently invisible.
- Correlation: `beginChatPerfTurn` mints a UUID, arms it one-shot; the transport attaches
  it as `x-chat-perf-id` (`use-detachable-chat-stream.ts:133`); disarm on non-dispatch at
  `use-chat-core.ts:799`.

### 2.2 Server prepare (Next.js)

All spans below are `server_span` events with `durationMs` and `ok`; carrier:
`app/api/chat/route.ts` and `app/api/chat/chat-turn-runtime.ts`. All are durations, all
run on `next`, none are deterministic (they include Convex round-trips), and none include
provider latency.

| Stage | Existing metric | Notes | Source |
|---|---|---|---|
| Request receipt | — none — (perf session created, no event) | no `server_request_received` marker exists | `route.ts:61` |
| Body parse + wire validation | — none — | `request_parse` is **declared but never emitted** | `route.ts:99-115`; declared `lib/observability/chat-performance.ts:81-95` |
| Auth (WorkOS session) | `auth_session` span | | `route.ts:85-87` |
| Logical model resolution | — none — | pure/synchronous; `model_config` **declared, never emitted** | `route.ts:158` → `lib/models/catalog.ts:738` |
| Usage admission (outer) | `usage_admission` span | encloses 5a/5b/5c below plus `incrementUsage` | `route.ts:192-265` |
| · Abuse rate limit (Convex `checkUsage`) | — no sub-span — | | `app/api/chat/api.ts:93` |
| · Attachment preflight | `attachment_resolution` span | includes `planGenerationInput` + trusted-text query | `route.ts:212-222`, `durable-generation-input.ts:65-108` |
| · Credential + route + reservation | `credential_resolution` span | **`reserveAuthorized` mutation has no span of its own** — reservation latency is not separable from credential resolution (`lib/model-route-resolver.ts:180-209`) | `route.ts:230-248` |
| Runtime construction (turn clock anchor) | — | `turnStartedAtMs = Date.now()` set **here**, not at request receipt | `chat-turn-runtime.ts:401` |
| Prepare (whole) | `prepare_total` span | | `route.ts:294` |
| · Tool setup (3 layers + MCP connect) | `tool_preparation` span | | `chat-turn-runtime.ts:588-605` |
| · Durable prepare (grant, run creation, history load) | `durable_prepare` span | history load is inside `prepareGeneration`; not separable | `chat-turn-runtime.ts:684-706` → `durable-turn-runtime.ts:1307-1362` |
| · Boundary-1 validation | `message_validation` span | | `chat-turn-runtime.ts:733-737` |
| · Trusted-text fetch (non-preflight path) | — none — | a network fetch inside `prepare_total` with no sub-span | `chat-turn-runtime.ts:764` |
| · History adaptation | `adaptationTimeMs` via `Date.now()` → `_tag:"history_adapt"` log + PostHog | **never reaches `chat_perf`**; the `history_adaptation` span name is declared, unused | `chat-turn-runtime.ts:837-948` |
| · Boundary-2 model-bound validation | `model_bound_validation` span | | `chat-turn-runtime.ts:955-962` |
| · `convertToModelMessages` + request shaping | — none — | | `chat-turn-runtime.ts:990-1011` |

### 2.3 Provider + transport

| Stage | Existing metric | Kind | Env | Det? | Ext? | Source |
|---|---|---|---|---|---|---|
| `streamText` invocation | `stream_start` span (via `perf.record`) | duration | next | no | no | `chat-turn-runtime.ts:1349-1357` |
| First provider event (any type) | `firstChunkLatencyMs` (`Date.now()`) → Braintrust bucket + Sentry tag only | duration | next | no | **yes** | `chat-turn-runtime.ts:1448-1456` |
| First provider **text** delta | — none — first chunk is type-agnostic (reasoning/tool/text all count) | | provider | no | yes | gap |
| First response bytes on the wire | — none — `Response` returned; platform pumps the stream; nothing after `createUIMessageStreamResponse` is instrumented | | next | no | yes | `chat-turn-runtime.ts:2033-2036` |
| First client stream bytes | — none — the transport never taps the body; the stream is deliberately unconsumed by app code | | browser | no | yes | `use-detachable-chat-stream.ts:152-159` |
| First client text delta | — none — deltas are parsed inside `@ai-sdk/react`; the only observation seam is `~registerMessagesCallback`, un-instrumented | | browser | no | yes | `lib/chat-performance/message-throttle.ts:63` |
| First chunk (client proxy) | `first_chunk_received` mark | start (proxy) | browser | no | yes | `chat-performance-client.ts:160` |

**`stream_start` anchor caveat (documented incorrectly in code).** Both the comment at
`chat-performance.ts:294` and the inline comment at `chat-turn-runtime.ts:1355-1356`
claim `stream_start` measures "request receipt → immediately before `streamText`". It
does not: `turnStartedAtMs` is set at runtime construction (`chat-turn-runtime.ts:401`),
which the route reaches **after** auth, body parse, contract validation, and the entire
usage-admission block. `stream_start` actually measures *runtime-construction →
streamText*. Until fixed, `stream_start` must not be summed with the admission spans as
if they were disjoint parts of one receipt-anchored timeline.

### 2.4 Rendering (browser)

| Stage | Existing metric | Kind | Det? | Source |
|---|---|---|---|---|
| Message publication cadence | — none — rAF coalescer has **zero counters** (no publish count, no coalesced-delta count) | | yes | `message-throttle.ts:18-82` |
| First visible text | `first_visible_text` mark (+ `textLengthBucket`) | completion (commit-time, **not paint**) | no | `chat-performance-client.ts:186` |
| Markdown projection latency | — none — only anomaly marks: `markdown_projection_reset` / `_fallback` / `_settle_mismatch` | | yes | `components/ui/markdown.tsx:405,415,430-436` |
| Shiki highlight | — none — no timing, no run/restart/discard counters | | yes | `lib/markdown/shiki-client.ts:193-211`, `components/ui/code-block.tsx:101-137` |
| Composer input → paint | `composer.keystroke_to_next_paint` / `composer.keystroke_to_settled_paint` marks (`durationMs`) | duration — **the only paint-adjacent measurement in the app** (rAF-chained, `event.timeStamp`-anchored) | yes | `lib/observability/composer-paint.ts:70-144`, wired `components/ui/prompt-input.tsx:708` |
| Long tasks / frame gaps / INP / vitals | — none — **zero `PerformanceObserver` usage repo-wide**; no web-vitals; React `Profiler` test-only | | | gap |
| Stream terminal (client) | `stream_terminal` mark | completion | `chat-performance-client.ts:162` |

**`stream_terminal` outcome defect:** the schema allows
`finish | error | abort | disconnect` (`chat-performance.ts:127-130`), but the emitter
collapses to `next === "error" ? "error" : "finish"` (`chat-performance-client.ts:164`).
A user Stop is indistinguishable from a natural finish in the marks.

### 2.5 Stop path

**Zero instrumentation end-to-end.** Click handler
`composer.tsx:451-456` → `use-generation-presentation-controller.ts:195-231`
(local stop, durable `stopGenerationRun` mutation, or deferred stop). No mark at the
click, none at the mutation dispatch, none at the button-glyph flip, no
stop-to-UI-feedback timing, no deferred-stop-window timing. The plan's "Stop → local UI
feedback under 100 ms" target is currently unmeasurable.

### 2.6 Durability + settlement

| Stage | Existing metric | Kind | Env | Source |
|---|---|---|---|---|
| Snapshot cadence (750 ms) | — cadence constant, not a metric — | | next | `durable-turn-runtime.ts:701-702` |
| Snapshot attempt | `checkpoint` counter `attempt` + `payloadBytes` | count | next | `durable-turn-runtime.ts:1439-1448` |
| Snapshot accepted / deduped | counter `accepted`; **`"deduped"` is emitted but silently dropped** — it is missing from the `checkpoint.kind` enum (`chat-performance.ts:179-191`), so `validateChatPerfEvent` rejects it and attempts never reconcile against outcomes | count | next | `durable-turn-runtime.ts:1460` |
| Snapshot lost / failed | counters `authority_lost`, `failed` | count | next | `durable-turn-runtime.ts:1474,1483` |
| Snapshot write round-trip (Next → Convex HTTP action → mutation) | — none — no per-write duration, no timeout on the wire | | next+convex | `durable-turn-runtime.ts:152-177,997-1012` |
| Snapshot mutation server side | — none — no accepted/stale/dedupe counters, no duration; note the dedupe compare runs `JSON.stringify` of stored **and** incoming parts on every checkpoint (`convex/chatRuntime.ts:2286-2288`), an unmeasured per-checkpoint cost; the run doc is patched every cadence tick even when content is deduped (`:2321-2334`), which alone invalidates `getSelectedConversation` | | convex | `convex/chatRuntime.ts:2247-2346` |
| Final flush | counter `final_flush` — **no duration**; `flushFinal` itself untimed | count | next | `durable-turn-runtime.ts:1733-1746` |
| Terminal write (`markGenerationRunCompleted`) | — none — bounded-retry write, untimed | | next+convex | `durable-turn-runtime.ts:1785-1797` |
| Settlement receipt | counters `settlement_receipt_confirmed` / `settlement_receipt_degraded` | count | next | `durable-turn-runtime.ts:1707,1757,1803` |
| Settlement receipt (client observation) | `durable_settlement_receipt` mark (`outcome`) | completion | browser | `chat-performance-client.ts:326` |
| Usage settlement (`settleUsageForTerminalRun`), reservation attach/release | — none — | | convex | `convex/usageAllowance.ts` |

### 2.7 Reactive reads + cross-client freshness

| Stage | Existing metric | Notes | Source |
|---|---|---|---|
| `getSelectedConversation` read cost | — none — the query `.collect()`s **every message in the chat, all branches, full `parts`**, no pagination, no projection; builds a branch context and clones every selected message (twice more for non-owners); zero logging of rows read/returned, bytes, or duration | | `convex/messages.ts:206-316`, `:102-110` |
| Client subscription updates | `selected_conversation_client` mark (`selectedCount`, `mappingDurationMs`) — **re-runs the whole mapping a second time purely to time it**, flag-gated; no update-per-turn counter, no result byte size | | `lib/chat-store/messages/provider.tsx:118-130` |
| What one reactive update delivers | — no metric — the full selected-path message array with complete `content`+`parts` (no delta wire); payload grows with conversation length × answer length | | `convex/messages.ts:244-316` |
| Same-tab back-nav re-adoption | `detached_binding_gauge` mark (8-event enum, counts only — no latency) | | `use-detachable-chat-stream.ts:203-213` |
| Second-tab / reload freshness | — none — no snapshot-accepted → other-tab-render timing exists, and (see §1.3) there is no adoption code path to instrument; the measurement must span two browser contexts joined externally | | gap |

## 3. Existing benchmark + fixture infrastructure (summary)

Everything lives in `benchmarks/chat-performance/` and runs via
`bun run bench:chat` (= `vitest bench --run benchmarks/chat-performance`).

- **Fixtures are code-generated, hashed, and deterministic** (`fixtures.ts`): mulberry32
  seeded PRNG; FNV-1a 64-bit `hashValue`/`projectionHash`; branch trees at 575/1,150 rows
  plus six named shapes and 200 seeded random trees; markdown payloads at ~500 B / ~12 KB
  / ~100 KB / 400-blocks / code 400 & 1,600 lines; a virtual stream script
  (`buildStreamScript`, six scenarios × 10/30/100 chunks-per-second, fully virtual clock)
  with a strict correctness folder (`foldStreamScript`, `:858`) enforcing dense monotonic
  sequences, single terminal, nothing-after-terminal.
- **Benches:** `branch-projection.bench.ts`, `markdown-projection.bench.ts`,
  `render-stream.bench.tsx` (pre-ADR-0016 baseline + Shiki). Gate tests (run in normal
  `bun run test`): fixture reproducibility, hash equivalence, the 5 ms p95 branch gate
  (env-gated behind `CHAT_PERF_GATES=true` — **nothing sets it anywhere**), markdown
  scaling gates. The one-off jsdom cadence-selection measurement was removed after the
  production cadence decision; the browser performance workflow owns ongoing evidence.
- **Output is `console.log` only.** No JSON serialization, no vitest reporter/outputFile,
  no CI execution of `bench:chat`, no artifact retention, no baseline comparison.
  Recorded baseline hashes (`4a062f446ff7b783` / `28eda0330f8c4e4e`) live in prose in
  `docs/measurements/2026-07-22-chat-performance-baseline.md` and are not asserted by any
  test.
- **No browser harness.** No Playwright config, dependency, or e2e directory. The browser
  half of the runbook is manual DevTools work; the only reusable pieces are the
  paste-into-console DOM probe and the trace sanitizer under
  `docs/measurements/evidence/2026-07-27-t3-naw-streaming/`.
- **Correctness coverage that Phase 3 can reuse:** rendered-DOM equivalence over the
  30-fixture markdown corpus (`components/ui/markdown.equivalence.test.tsx`), projection
  equivalence at every prefix (`lib/markdown/incremental-block-projection.test.ts`),
  byte-identical settle (`markdown.streaming.test.tsx:275`), server word-chunking
  ordering invariants (`app/api/chat/word-chunking-transform.test.ts`), frame-aligned
  publication seam test (`use-chat-core.ai-sdk-seam.test.tsx:835`). Note the chunk-level
  missing/duplicate/reordered/post-terminal suite (`fixtures.test.ts:227-257`) tests the
  **fixture folder**, not the production stream path.

## 4. Instrumentation gap proposal (Phase 2 scope)

> **Status (2026-08-27, same day):** §4.1 items 1, 3 (via the receipt-anchored
> `provider_request_started` companion; `stream_start` keeps its historical clock with
> corrected docs), and 4 are implemented; §4.1 item 2 is implemented for `abort`
> (`disconnect` remains indistinguishable client-side). §4.2 is implemented except
> `server_request_received` (the receipt anchor exists implicitly as the zero point of
> the receipt-anchored spans) and the paint-adjacent `first_visible_text` variant.
> §4.3 is implemented except delta-receipt→painted-frame and DOM-node counts
> (harness-side, Phase 3). §4.4 is implemented (`CHAT_PERF_CONVEX_SAMPLE_RATE`,
> `_tag:"chat_perf_convex"`), except the `usage_reservation` sub-span, deferred to
> Experiment 1 which restructures admission anyway. The metric dictionary's per-row
> statuses are authoritative.

Ordered by measurement value. All additions stay inside the existing allow-listed,
content-free system (`EVENT_SCHEMAS` + `validateChatPerfEvent`); every new event/field
must be added to the schema table and covered by the privacy tests.

### 4.1 Defect fixes (do first — they corrupt existing data)

1. **Add `"deduped"` to the `checkpoint.kind` enum** (`chat-performance.ts:179-191`).
   Today `durable-turn-runtime.ts:1460` emits it and the validator silently drops it, so
   `attempt ≠ accepted + authority_lost + failed` with no explanation. Add a test pinning
   every `counter()` call site's kind to the enum.
2. **Emit real `stream_terminal` outcomes.** Wire `abort`/`disconnect` through
   `chat-performance-client.ts:162-164` (the schema already allows them).
3. **Fix the `stream_start` anchor or its documentation.** Either re-anchor
   `turnStartedAtMs` at request receipt (preferred: pass `performance.now()` captured at
   `route.ts:61` into runtime construction) or correct the two comments and the runbook
   so nobody sums it with admission spans.
4. **Emit the three declared-but-dead spans:** `request_parse` (`route.ts:99-115`),
   `model_config` (`route.ts:158` — cheap, but proves it stays cheap), and
   `history_adaptation` (promote the existing `adaptationTimeMs` into `perf.record`).

### 4.2 New lifecycle events (plan §2.1) → concrete insertion points

| Proposed event | Insertion point |
|---|---|
| `server_request_received` | `route.ts:61` — emit at perf-session creation; becomes the server anchor all server spans are offset against |
| `provider_request_started` | immediately before `streamText` (`chat-turn-runtime.ts:1346`) — receipt-anchored replacement/companion for `stream_start` |
| `provider_first_event` | promote `firstChunkLatencyMs` (`chat-turn-runtime.ts:1454-1456`) into a `chat_perf` event with a `chunkType` bucket dimension |
| `provider_first_text_delta` | same `onChunk` callback, first chunk with `type === "text-delta"` |
| `server_first_stream_write` | identity `TransformStream` tap around `responseStream` before `createUIMessageStreamResponse` (`chat-turn-runtime.ts:2033`), timestamping the first enqueued chunk |
| `client_first_stream_bytes` | tap the response body in `AcceptanceAwareChatTransport.sendMessages` (`use-detachable-chat-stream.ts:159`) with a pass-through `TransformStream`; mark on first chunk. Must not consume the stream |
| `client_first_text_delta_received` | same tap, first SSE frame whose event type is a text delta — parse the envelope type only, never the payload |
| `first_visible_text` | exists (commit-time); add a paint-adjacent variant using the `composer-paint.ts` rAF-chain technique |
| `response_stream_closed` | `onEnd` (`chat-turn-runtime.ts:1927`) server-side; `stream_terminal` already covers the client |
| `final_snapshot_requested` / `final_snapshot_accepted` | around `tracker.flushFinal` (`durable-turn-runtime.ts:1734-1746`), with `durationMs` — requires allowing a duration field on `checkpoint` or a new `settlement_span` event; also time the terminal write (`:1785-1797`) |
| `request_dispatched` (true fetch) | inside `AcceptanceAwareChatTransport.sendMessages` before `super.sendMessages`, replacing the status-transition proxy |
| Stop events | `stop_intent` mark at `use-generation-presentation-controller.ts:197`; `stop_ui_feedback` when the composer primary action flips; `durable_stop_dispatched` at the mutation call |

### 4.3 Browser responsiveness (plan §2.2)

- One `PerformanceObserver` module (instrumentation builds only): `longtask` entries,
  longest task, TBT accumulation; rAF-gap sampler during streaming; delta-receipt →
  next-painted-frame via the existing `measureAfterFrames` technique
  (`composer-paint.ts:70`).
- **Counters in the rAF coalescer** (`message-throttle.ts`): deltas received,
  publications, coalesced count — the single highest-value insertion point; today
  "commits per N deltas" cannot be answered.
- Markdown projection duration around `advanceMarkdownProjection`
  (`markdown.tsx:405,415`) — render-phase, so accumulate into a ref and flush
  post-commit; Shiki invocation count + duration around `highlightCode`
  (`code-block.tsx:101`), including grammar-load vs highlight split.
- DOM node count at stream start/end; heap via CDP only (harness-side, Phase 3).

### 4.4 Convex-side (plan §2.3)

Convex has no metrics today, and the correlation ID must **stay out of Convex by design**
(`chat-performance.ts:20-24`). Proposal:

- Content-free bucketed logging inside `getSelectedConversationForViewer`: messages-read
  bucket, selected-count bucket, parts-bytes bucket (power-of-2), sampled by an env-gated
  rate — joined to turns statistically, not per-request.
- Counters in `updateAssistantSnapshotForChat`: applied / stale / deduped / lost, plus a
  payload-bytes bucket. This gives the server-side mirror of the Next-side checkpoint
  counters and closes the accepted-vs-rejected story end to end.
- Per-write duration for the worker wire on the **Next side**
  (`durable-turn-runtime.ts:997-1012` dispatcher) — wraps every snapshot, step, approval,
  heartbeat, and terminal write with one span; no Convex change needed.
- Deployment-level invocation/bandwidth numbers come from the Convex dashboard/MCP
  (`mcp__convex__insights`), not app logs — record them per benchmark run in the result
  file, not per request.
- Add the plan-mandated telemetry privacy tests: property tests proving new fields reject
  content-shaped and secret-shaped values (extend `chat-performance.test.ts`).

### 4.5 What Phase 3 must supply (cannot be closed by instrumentation)

- Paint-truth (frame presentation) — only a tracing harness sees real paints; all current
  marks are commit-time.
- Cross-tab freshness — needs two browser contexts with an external shared clock.
- Heap growth — CDP session.
- Machine-readable results — the versioned JSON schema from the plan; benches currently
  print to stdout only.
