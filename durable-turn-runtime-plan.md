# Archived implementation plan: Durable turn runtime

Status: completed 2026-07-05 and retained as historical implementation context.
Do not use this file as the active source of truth for current architecture or
pending work; use `CONTEXT.md` and `docs/adr/0009-durable-turn-runtime.md`.

This plan described implementing ADR-0009: extracting ALL durable knowledge from
the **Chat turn runtime** (`app/api/chat/chat-turn-runtime.ts`) into one deep
module — the **Durable turn runtime**
(`app/api/chat/durable-turn-runtime.ts`), absorbing
`app/api/chat/durable-runtime.ts` as internal vocabulary. The parent lost every
`durable && convexToken` branch, five mutable cells, and the `convexToken`
reference in `toResponse()`; the fragile `durableFinal*` handoff became a named
two-method protocol with a LOUD miss.

**Branch discipline: work on the current branch. Do not create or switch branches.**

---

## 1. Sequencing & non-conflict contract (vs generation-run-lifecycle-plan)

This plan is **step 2**. Do not start until generation-run-lifecycle-plan's
Definition of done is met (`convex/domain/generation_run_lifecycle.ts` + matrix
test exist, seven sites rewired, its two integration tests green).

**Disjoint file sets — the structural non-conflict guarantee:**

| Plan | Touches | Never touches |
| --- | --- | --- |
| generation-run-lifecycle (step 1) | `convex/chatRuntime.ts`, `convex/domain/**`, `convex/chatRuntime.test.ts` | `app/api/chat/**` (its §7 wire-check: "app/api/chat/* must not need edits") |
| **this plan (step 2)** | `app/api/chat/**`, CONTEXT.md `_Status_` line, `docs/adr/0009` status line | `convex/**` — if an edit there feels necessary, the cut has drifted; stop and reassess |

**Frozen wire, both directions.** The seven `api.chatRuntime.*` calls
(`prepareGeneration`, `updateAssistantSnapshot`, `recordToolInvocations`,
`createToolApprovalRequest`, `markGenerationRunCompleted`,
`markGenerationRunFailed`, `markGenerationRunAborted`) keep their argument and
return shapes exactly. This plan relocates the call sites; it changes no payloads.

**Tolerances inherited from step 1 (encode, don't fight):**

- Lifecycle §6.4: `createToolApprovalRequest` may resolve to an **ignore**
  verdict on a settled run (and may return `null`). The approval-persistence
  transform already ignores the mutation's return value — only a rejection is a
  failure. Preserve that: do NOT add a null-check throw in the moved transform.
- All `markGenerationRun*` writes against settled runs resolve to `ignore`
  server-side. The module keeps issuing benign double-terminal writes
  (stream `onAbort` + envelope `isAborted`) with their two distinct reasons —
  ADR-0009's no-client-dedup invariant is the *consumer* of the lifecycle
  module's first-terminal-wins rule. Do not "optimize" either side away.

**Do-not-revert list (already landed on this branch):**

- ADR-0008 prune: `chatVersion` is no longer sent to `prepareGeneration` — the
  new module's `prepare()` must not resend it. `search-tools.ts` stays deleted.
- The lifecycle module and its CONTEXT.md/ADR entries — read-only to this plan.

---

## 2. Design decisions (already made — ADR-0009, do not relitigate)

| Decision | Choice |
| --- | --- |
| Module | `app/api/chat/durable-turn-runtime.ts`; type `DurableTurnRuntime`; selecting factory `createDurableTurnRuntime({ input, deps })` — sync, pure, internalizes `isDurableConvexChat`; adapters `createConvexDurableTurn` / `createGuestDurableTurn` (both exported for direct test construction) |
| Construction timing | At the top of `createChatTurnRuntime`'s body — non-null from birth, so `fail()` never null-checks. `provider` crosses at `prepare({ provider })` (resolved mid-parent-prepare); everything else (chatId, requestId, model, messages, token, edit/regeneration, selected-path-token fields) crosses at construction |
| Surface | `mode` (observability only — never branch on it) · `prepare({provider}) → Promise<MessageAISDK[]>` (returns canonical history) · `streamTextExtras(toolFacts)` · `onChunk` · `recordStep` · `noteStreamError(msg)` · `onStreamAbort(reason)` · `captureFinish(facts)` · `uiStreamIdentity(validatedMessages)` (method, NOT a getter — guest needs the post-validation array) · `finalize({responseMessage, isAborted, finishReason})` · `fail(err)` |
| Await discipline | In return types: `void` = fire-and-forget by contract (`onChunk`, `recordStep`, `noteStreamError`, `captureFinish`); `Promise` = must await (`prepare`, `onStreamAbort`, `finalize`, `fail`). `finalize` may reject on completion-write failure (today's envelope semantics); everything else never throws |
| Loud fallback | Non-aborted `finalize` without a prior `captureFinish`: structured `console.warn({_tag: "durable_finish_handoff_missed", requestId, chatId, runId})` + `Sentry.captureMessage("durable_finish_handoff_missed", {level: "warning"})`, THEN `countToolParts(responseMessage)` fallback — the write still lands |
| Ports | Convex wire: direct injected `deps.fetchMutation` + token, no store port. Tool runtime: the `ToolFacts` structural port (below). AI SDK shapes: direct, no insulation |
| `ToolFacts` shape (refinement of ADR-0009, verified against `lib/tools/runtime.ts`) | Mirror `ToolRuntime`'s members so the parent passes `tool` directly: `{ metadata: { source(name): ToolSource }, approvalFor(name), toolApproval }`. At implementation, check whether `RuntimeToolApprovalDecision` (the `approvalFor` return) carries `reason`/`riskClass`; if yes, the transform's `runtimeApprovalByToolName` map-threading dissolves into `approvalFor` (ADR intent); if no, add `approvalDecisionsByToolName` to the port. `outcomeSummary()` stays OUT — finish counts are pushed as data via `captureFinish` |
| ADR-0006 invariant | Both `onEnd` layers stay in `toResponse()`'s single closure; they call into the module. The module never owns a callback |
| Rejected shapes | See ADR-0009 §Rejected — `commit(event)` union, two-scope surface, SDK-callback method names, `DurableStore` port, `describeRun()` (moot per ADR-0008), day-one `onWriteEvent` |

---

## 3. Current-state map (working tree of 2026-07-05, post-ADR-0008 prune)

All in `app/api/chat/chat-turn-runtime.ts`. Line refs are current-tree (the
prune removed one line ~582; step 1 does not touch this file, so refs stay valid).

### The 11 touchpoints → target method

| # | Site (anchor by code, not line) | Today | Becomes |
| --- | --- | --- | --- |
| 1 | `prepare()`: `isDurableConvexChat` gate + durable-prepare block (`~553–658`: `extractApprovalResponses`, regen×approvals 400, `latestUserMessage`, `prepareGeneration` + arg-validation→400 catch, sanitize, `durableRunState` + tracker build, `durable_chat_runtime_prepared` log) | ~105 lines | `canonicalMessages = await durableTurn.prepare({ provider: resolvedProvider })` |
| 2 | `prepare()`: unconditional `sanitizeModelHistoryMessages(canonicalMessages)` (`~660–662`) | second sanitize | DELETE — both adapters return already-canonical history (guest adapter sanitizes too) |
| 3 | `toResponse()`: `toolApproval` gating spread (`...(durable && convexToken && tool.toolApproval ? …)`) | conditional spread | folded into `...durableTurn.streamTextExtras(tool)` |
| 4 | `toResponse()`: `experimental_transform: createRuntimeApprovalPersistenceTransform({…approvalWritePromises…})` spread | conditional spread, shared array | same fold; backpressure array becomes module-private |
| 5 | `onChunk`: `durable?.snapshotTracker?.onChunk(chunk)` | optional chain | `durableTurn.onChunk(chunk)` |
| 6 | `onStepEnd`: `if (durable && convexToken) { invocations mapping (~57 lines) + void fetchMutation(recordToolInvocations) }` | inline mapping + fire-and-forget | `durableTurn.recordStep({ stepNumber: stepCounter, toolCalls, toolResults })` — status derivation (`completed`/`failed`/`pending_approval`/`called`) moves inside |
| 7 | `onError`: `if (durable && convexToken) { void fetchMutation(markGenerationRunFailed)… }` | fire-and-forget block | `durableTurn.noteStreamError(errorMessage)` (parent already computes `errorMessage` for telemetry — pass the string) |
| 8 | `onAbort`: `await durable.snapshotTracker?.flush(); await markRunAborted("stream aborted")` | flush + local helper | `await durableTurn.onStreamAbort("stream aborted")` |
| 9 | stream `onEnd`: `await durable?.snapshotTracker?.flush()` + the three `durableFinal*` cell writes | in-memory handoff | `durableTurn.captureFinish({ usage: {…}, finishReason, toolCounts: { totalToolCalls, failedToolCalls } })` — sync; the flush moves into `finalize` (see risk note §7) |
| 10 | envelope config `originalMessages: durable?.originalMessages ?? validatedMessages` + `generateMessageId` ternary; envelope `onEnd` (allSettled → flush → markAborted \| markCompleted with silent `countToolParts` fallback) | identity ternaries + 28-line terminal body | `const identity = durableTurn.uiStreamIdentity(validatedMessages)` spread; `onEnd: ({responseMessage, isAborted, finishReason}) => durableTurn.finalize({responseMessage, isAborted, finishReason})` |
| 11 | `fail()`: guarded `markGenerationRunFailed` block | 26 lines | `await durableTurn.fail(err)` (after `toolRuntime.dispose()`, before Sentry capture — order unchanged) |

### Cells and locals DELETED from the parent

`durableRunState` (+ its type import), `durableFinalUsage`,
`durableFinalFinishReason`, `durableFinalToolCounts`, `approvalWritePromises`,
the local `markRunAborted` helper, `const durable = durableRunState`.
`convexToken` disappears from `toResponse()` entirely.

### What STAYS in the parent (do not move)

- All telemetry and its cells: timing (`streamStartMs`, `firstChunkLatencyMs`,
  `reasoningStartMs/DurationMs`, `lastChunkAtMs`, `lastProgressAtMs`), the stall
  watchdog cluster, Sentry/Braintrust/PostHog blocks, `captureChatLifecycleSignal`.
- The `messageMetadata` envelope callback (reads telemetry-owned
  `toolMetadataByCallId` + `reasoningDurationMs`).
- The ai@7 system-role exclusion + `validateUIMessages` + `convertToModelMessages`
  + adapters/replay + OpenAI plaintext fallback (ADR-0006 deferred, still deferred).
- `tool.onStepFinish(...)` in `onStepEnd` (Tool outcome recording — Tool runtime
  concern, not durable persistence).

### Facts verified for this plan (2026-07-05)

- `durable-runtime.ts` importers: exactly `chat-turn-runtime.ts` +
  `durable-runtime.test.ts`. Absorption breaks no one else.
- `uiMessageChunkToPayload` (durable-runtime.ts): **zero importers — delete, do not move.**
- `ToolRuntime` (lib/tools/runtime.ts) exposes `metadata: ToolMetadataResolver`
  (with `.source`), `approvalFor(name)`, `approvalDecisionsByToolName`,
  `toolApproval`, `outcomeSummary()` — the structural `ToolFacts` pass-through works.

---

## 4. Step A — the module (no caller edits yet)

**New file `app/api/chat/durable-turn-runtime.ts`**, containing:

1. Types: `ToolFacts`, `DurableStreamTextExtras`, `StreamFinishFacts`,
   `DurableTurnRuntime`, `DurableTurnInput`, `DurableTurnDeps` — per §2 and the
   interface block in ADR-0009.
2. `createGuestDurableTurn(input)`: `prepare` → `sanitizeModelHistoryMessages(input.messages)`,
   zero network; `streamTextExtras` → `{}`; `uiStreamIdentity(v)` →
   `{ originalMessages: v }` (no `generateMessageId`); every write method a
   typed no-op; `mode: "guest"`.
3. `createConvexDurableTurn(input & { convexToken: string })`: the full timeline.
   Moved-in internals (from durable-runtime.ts, now private unless a test needs
   them export-for-test): `createDurableSnapshotTracker` (750ms content-versioned
   throttle, 10s timeout, overlapping-flush protocol — move the L203–209 comment
   with it), `createRuntimeApprovalPersistenceTransform` (backpressure array now
   a private field), `extractApprovalResponses`, `hasApprovalResponse`,
   `getLatestUserMessage`, `toDurableUiMessage(s)`, `countToolParts`,
   `getFinalAssistantText`, `isDurableConvexChat`, `sanitizeModelHistoryMessages`
   re-export, `DurableUiMessage` type.
4. `createDurableTurnRuntime`: applies `isDurableConvexChat({isAuthenticated,
   convexToken, chatId})`, returns one adapter.
5. One-shot guards: second `prepare()` throws; `streamTextExtras` before
   `prepare` resolution or twice throws; `recordStep` before `streamTextExtras`
   throws (programming errors, not ops events).
6. The warn-tag vocabulary moves verbatim: `durable_prepare_argument_rejected`,
   `durable_chat_runtime_prepared`, `canonical_tool_invocation_write_failed`,
   `tool_approval_request_write_failed`, `durable_run_abort_write_failed`,
   `durable_run_failed_write_failed`; new: `durable_finish_handoff_missed`.
   Keep field sets identical (requestId, chatId, runId, error) — ops greps depend on them.
7. `finalize` internal order (the load-bearing sequence, moved from the envelope
   `onEnd`): `await Promise.allSettled(approvalWritePromises)` → `await flush().catch(() => {})`
   → `isAborted ? markAborted("ui message stream aborted") : markCompleted(…)`.
   Completion payload assembly moves in: `getFinalAssistantText(responseMessage)`,
   `responseMessage.parts`, `projectPersistedMessageMetadata(responseMessage.metadata)`,
   `finishReason` precedence (captured over envelope), captured usage, tool counts
   (captured, else LOUD fallback).

Gate: `bunx tsc --noEmit` clean. Nothing imports the module yet.

---

## 5. Step B — module tests BEFORE rewiring

**New file `app/api/chat/durable-turn-runtime.test.ts`** — ADR-0009's five lean
tests, driven through the public interface with a recording `fetchMutation` fake
(capture `(fnRef, args, opts)` tuples; resolve/reject on cue; identify functions
via `getFunctionName` as `chat-turn-runtime.test.ts` already does):

1. **Handoff loud-miss** — `finalize` without `captureFinish` → warn tag +
   `Sentry.captureMessage` spy + completion write carries `countToolParts` values.
2. **Terminal ordering** — deferred approval write + dirty snapshot: recorded
   order is approval-settled → `updateAssistantSnapshot` → `markGenerationRunCompleted`;
   the `isAborted` variant marks aborted and never rejects.
3. **`prepare()` error mapping** — regen×approvals → `{statusCode:400}`;
   arg-validation error → 400 after `durable_prepare_argument_rejected`;
   a concurrency-guard error passes through untouched (pin the count-drift
   relocation: assert `expectedVisibleMessageCount`/`tailMessageId` forwarded
   verbatim into the `prepareGeneration` args).
4. **Guest inertness** — full lifecycle drive on `createGuestDurableTurn`:
   zero `fetchMutation` calls, identity passthrough, `{}` extras.
5. **`fail()` at each phase** — pre-`prepare` no-op; post-`prepare` writes
   `markGenerationRunFailed`; write rejection warns and resolves.

Gate: `bun run vitest run app/api/chat/durable-turn-runtime.test.ts` green.

---

## 6. Step C — rewire `prepare()` (touchpoints 1–2)

1. Top of `createChatTurnRuntime`: construct `durableTurn` (replaces the
   `durableRunState` cell declaration).
2. Replace the durable-prepare block with the two-line call; delete the
   trailing unconditional sanitize (touchpoint 2).
3. **Relocate the Selected path token / edit / regeneration args verbatim**
   (construction-time input) — this is ADR-0006 risk (c) and the known
   count-drift edge; no reshaping, no re-validation.

Gate: `bun run vitest run app/api/chat/` — `chat-turn-runtime.test.ts` prepare
suites must pass with only mock-wiring updates (the `prepareGeneration`
assertions now observe the module's calls through the same injected
`fetchMutation` — arg shapes unchanged, so assertions should survive).

## 7. Step D — rewire `toResponse()` (touchpoints 3–10)

Apply the §3 table. Order within the step: extras spread (3–4) → `onChunk` (5)
→ `onStepEnd` (6) → `onError` (7) → `onAbort` (8) → stream `onEnd` (9) →
envelope identity + `onEnd` (10). Delete the dead cells and `markRunAborted`
after all sites compile.

Risk notes:

- **Touchpoint 9 moves the stream-onEnd flush into `finalize`.** Today the
  stream `onEnd` awaits a flush before telemetry; the envelope `onEnd` flushes
  again. The tracker's content-versioned protocol makes the second flush a
  no-op when clean, so consolidating to `finalize` (plus the existing
  `onStreamAbort` flush) preserves every write that matters. If the seam test
  (below) disagrees, keep an internal flush inside `captureFinish` instead —
  decide by test, not by taste.
- `onStepEnd` still calls `tool.onStepFinish(...)` BEFORE `recordStep` —
  budget/outcome accounting order is unchanged.
- The two abort reasons stay distinct (`"stream aborted"` /
  `"ui message stream aborted"`).

Gate: `bun run vitest run app/api/chat/chat-turn-runtime.ai-sdk-seam.test.ts` —
this suite exercises the dual-`onEnd` handoff and approval persistence; it is
the behavioral referee for this step. Update its mocks minimally; if an
assertion must change semantically, stop and re-check against §3.

## 8. Step E — rewire `fail()` (touchpoint 11)

`dispose()` → `await durableTurn.fail(err)` → Sentry capture, order preserved.
Gate: full `bun run vitest run app/api/chat/`.

## 9. Step F — absorb `durable-runtime.ts`

1. Point remaining imports (there are none outside the two files — verified §3)
   at the new module; delete `durable-runtime.ts`.
2. `durable-runtime.test.ts`: retarget to `durable-turn-runtime.ts`. Tracker
   and transform suites survive as internals tests (export-for-test or drive
   through the module); the helper suites (`isDurableConvexChat`,
   `extractApprovalResponses`, `toDurableUiMessage`) keep passing against the
   moved exports. **Delete the brittle `readFileSync` source-ordering assertion
   (old durable-runtime.test.ts:206)** — ADR-0006 scheduled its death once the
   ordering had a real unit test; step B test 2 is that test. Rename the file
   or fold into the module's test — prefer fold if the combined file stays lean.
3. Delete `uiMessageChunkToPayload` (dead) and any now-unused imports in the parent.

## 10. Verify

- `bun run vitest run` (full suite), `bunx tsc --noEmit`, `bun run lint`.
- **Scope check (mirror of step 1's wire check):** `git diff --stat` since the
  step-1 completion point shows only `app/api/chat/**`, `CONTEXT.md`,
  `docs/adr/0009-durable-turn-runtime.md`. Zero `convex/**` lines.
- Grep gates: `grep -c "durable && convexToken" app/api/chat/chat-turn-runtime.ts`
  → 0; `grep -c "convexToken" app/api/chat/chat-turn-runtime.ts` → construction
  block only; `grep -rn "durableFinal\|approvalWritePromises" app/api/chat/chat-turn-runtime.ts` → 0.
- Optional live smoke (user's dev server owns :3000 — do not restart it):
  one guest send, one durable send, one mid-stream Stop; confirm the durable
  chat's terminal status and that no `durable_finish_handoff_missed` warn fires
  on the happy path.
- Docs: flip CONTEXT.md `Durable turn runtime` `_Status_` to
  `implemented <date> (branch darknight/bat-signal-20260705-133514)`; update
  ADR-0009 status line from "designed; implementation pending" to "accepted".

## 11. Definition of done

- `durable-turn-runtime.ts` exists with both adapters + selecting factory;
  `durable-runtime.ts` is gone; the five module tests plus the retargeted
  tracker/transform tests are green; the seam test passes.
- The parent has zero `durable ?` branches, zero handoff cells, no
  `markRunAborted` local, and `toResponse()` never reads `convexToken`.
- Warn-tag vocabulary intact + `durable_finish_handoff_missed` reachable
  (proven by test 1).
- No `convex/**` edits; wire shapes unchanged; ADR-0008/step-1 work untouched.
- CONTEXT.md status flipped; commit message uses CONTEXT.md vocabulary
  (Durable turn runtime, Chat turn, Tool runtime, Generation run) and ends with
  the standard co-author line.
