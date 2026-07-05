# 9. Durable persistence is a deep module: the Durable turn runtime

- Status: accepted
- Date: 2026-07-05
- Context: Architecture deepening — generation runtime core; branch
  `darknight/bat-signal-20260705-133514`
- Related: ADR-0006 (Chat turn runtime — this module is the internal seam it
  composes), ADR-0008 (no stream-resume read surface — removes a widening
  path this design would otherwise have to reserve)

## Context

After ADR-0006, `toResponse()` in `app/api/chat/chat-turn-runtime.ts` is one
~750-line closure holding ~25 mutable cells. Its durable-persistence concern
is smeared across **11 touchpoints** as `durable && convexToken` branches:
durable-prepare (~100 lines in `prepare()`), the `toolApproval` gating spread,
the approval-persistence transform (sharing a mutable `approvalWritePromises`
array with the envelope `onEnd`), the snapshot feed in `onChunk`, a ~57-line
tool-invocation mapping in `onStepEnd`, fire-and-forget failure marks in
`onError`, flush+abort in `onAbort`, the `durableFinal*` writes in the stream
`onEnd`, durable identity (`originalMessages`/`generateMessageId`) in the
envelope config, the terminal sequence in the envelope `onEnd`, and the
guarded failure mark in `fail()`.

The fragile heart ADR-0006 named — the `durableFinalUsage` /
`durableFinalFinishReason` / `durableFinalToolCounts` handoff between the two
`onEnd` layers — is three loose `let` cells whose failure mode is a **silent**
`countToolParts(responseMessage)` fallback that masks the bug. The
write-ordering contract (settle approval writes → flush snapshot → terminal
mark) exists only inline at the envelope `onEnd`. Guest-vs-durable is
re-derived at every touchpoint.

Four independent interface designs (minimal / flexible / caller-first /
ports-&-adapters) were produced and compared; they converged on the seam and
diverged on surface shape. This ADR records the adopted hybrid.

## Decision

Introduce the **Durable turn runtime** (`CONTEXT.md`):
`app/api/chat/durable-turn-runtime.ts`, absorbing `durable-runtime.ts`'s
stateful factories (snapshot tracker, approval transform) as internal
vocabulary. It owns all durable knowledge for one Chat turn; the Chat turn
runtime composes it inside `toResponse()`'s closure — **both `onEnd` layers
remain in that one closure (ADR-0006 intact); they call into the module,
which names the handoff instead of splitting it.**

### Interface

```ts
// Selecting factory — sync, pure, called at the top of createChatTurnRuntime.
// Internalizes isDurableConvexChat(); returns the Convex adapter or the inert
// guest adapter. The parent never branches on durability again; fail() never
// null-checks. The convex token crosses here, once.
createDurableTurnRuntime({ input, deps: { fetchMutation } }): DurableTurnRuntime

type DurableTurnRuntime = {
  /** Observability dimension only — callers MUST NOT branch on it. */
  readonly mode: "durable" | "guest"

  /** Durable-prepare: prepareGeneration (approval-response extraction, the
   *  regeneration×approvals 400, latestUserMessage selection, the Convex
   *  argument-validation → 400 mapping after the
   *  `durable_prepare_argument_rejected` warn; concurrency-guard errors pass
   *  through unmapped). Returns the canonical model history — durable:
   *  sanitized server history; guest: sanitized input. One-shot. */
  prepare(args: { provider: string }): Promise<MessageAISDK[]>

  /** Binds ToolFacts for the stream lifetime; returns the spreadable extras
   *  (toolApproval gate + approval-persistence transform). Guest: {}.
   *  One-shot, before the stream starts; recordStep before binding throws. */
  streamTextExtras(toolFacts: ToolFacts): DurableStreamTextExtras

  // Write timeline — void = fire-and-forget BY CONTRACT, Promise = await.
  onChunk(chunk: TextStreamPart<ToolSet>): void          // throttled snapshots
  recordStep(step: { stepNumber, toolCalls, toolResults }): void
  noteStreamError(errorMessage: string): void            // mark failed
  onStreamAbort(reason: string): Promise<void>           // flush → mark aborted

  /** Stream-onEnd half of the finish handoff (sync capture). */
  captureFinish(facts: {
    usage: { inputTokens?; outputTokens?; totalTokens? }  // ai@7 ALL-steps aggregate
    finishReason: string | undefined
    toolCounts: { totalToolCalls: number; failedToolCalls: number } // pushed as
  }): void                                                // data, not pulled via port

  /** Envelope identity: durable history + assistant-message-id factory, or
   *  guest passthrough of the POST-validation array (why this is a method
   *  taking validatedMessages, not a construction-time getter). */
  uiStreamIdentity(validatedMessages: MessageAISDK[]): {
    originalMessages: UIMessage[]
    generateMessageId?: () => string
  }

  /** Envelope-onEnd terminal write. Internal ordering, load-bearing:
   *  allSettled(approvalWritePromises) → flush → markAborted | markCompleted.
   *  LOUD-FALLBACK CONTRACT: completed path without a prior captureFinish()
   *  emits structured warn `durable_finish_handoff_missed` + Sentry
   *  captureMessage BEFORE falling back to countToolParts — the write still
   *  lands; the bug no longer hides. May reject on completion-write failure
   *  (today's envelope semantics). */
  finalize(outcome: { responseMessage: UIMessage; isAborted: boolean
                      finishReason?: string }): Promise<void>

  /** Legal at ANY phase: pre-prepare (no run → no-op), mid-stream, or after
   *  finalize() (first-terminal-wins absorbs it). Never throws. */
  fail(error: unknown): Promise<void>
}

/** The one port. Structural — ToolRuntime satisfies it as-is; tests hand in
 *  a literal. Subsumes today's map+resolver threading into the transform. */
type ToolFacts = {
  source(toolName: string): ToolSource
  approvalFor(toolName): { needsApproval?; reason?; riskClass? } | undefined
  toolApproval: Record<string, ToolApprovalStatus> | undefined
}
```

### Ports map (decided per dependency, not reflexively)

- **Convex wire: direct.** `deps.fetchMutation` + token injected once, no
  `DurableStore` interface. Tests fake `fetchMutation` (the established
  seam); guest lives a level up as an adapter of the module itself; no second
  store is named. A 7-method port would re-declare what Convex codegen
  declares, with one forever-adapter.
- **Tool runtime: the `ToolFacts` port.** Second adapter is the test literal;
  precedent is `ToolSourceResolver` (durable-runtime.ts). `outcomeSummary()`
  is deliberately excluded — finish counts are data captured at a moment
  (stream `onEnd`), pushed via `captureFinish`.
- **AI SDK shapes: direct.** `TextStreamPart`/`UIMessage`/`StreamTextTransform`
  cross unwrapped. The v7 migration (PR #97) was absorbed at call sites in an
  afternoon; an insulation layer would have doubled that rename surface, and
  `UIMessage` is the storage shape on the Convex side too.

### Invariants

- Two production adapters behind the selecting factory: Convex and inert
  guest (identity passthrough, `{}` extras, no-op writes). "Guest chats run
  ungated" becomes structural.
- Await discipline is encoded in return types, not comments.
- No client-side dedup of double-terminal writes (stream `onAbort` +
  envelope `isAborted`): the Generation run lifecycle's first-terminal-wins
  is the invariant; both abort reasons (`"stream aborted"`,
  `"ui message stream aborted"`) stay distinct for ops queries.
- The warn-tag ops vocabulary moves in verbatim and gains one member:
  `durable_prepare_argument_rejected`, `durable_chat_runtime_prepared`,
  `canonical_tool_invocation_write_failed`,
  `tool_approval_request_write_failed`, `durable_run_abort_write_failed`,
  `durable_run_failed_write_failed`, + **`durable_finish_handoff_missed`**.
- Net effect on the parent: the cells `durableRunState`, `durableFinal*`
  (×3), `approvalWritePromises`, the local `markRunAborted`, and all 11
  `durable ?` branches are deleted; `convexToken` disappears from
  `toResponse()` entirely.

### Rejected alternatives (do not relitigate)

- **Single `commit(event)` union (minimal design).** Deepest surface, but
  moves the fire-and-forget/awaited contract out of the type system — the
  exact bug class this refactor kills. Its async factory-as-prepare also
  forces a `?.` back into `fail()`.
- **Two-scope surface (`forStream()` returning a second object).** The phase
  guard inside one object is enough; two handles in one closure invite
  holding the wrong one.
- **SDK-callback method names (`onStepEnd`, `onUiStreamEnd`).** Reads well at
  the call site but bakes ai@7 envelope names into the interface; intent
  names (`recordStep`, `finalize`) survive SDK churn. (Await-typing and the
  ~15-line hand-written fake from that design are kept.)
- **"Turn persistence runtime" as the name.** Principled (guests aren't
  durable), but "durable" is the domain's load-bearing adjective
  (durable-prepare, durable contract, `isDurableConvexChat`), and the guest
  adapter is the null object of durability — guests have none, not a
  different kind.
- **`describeRun()` for stream-resume.** Moot: ADR-0008 descoped resume
  outright; reconnect renders durable message docs (ADR-0001).
- **`deps.onWriteEvent` write-journal tap.** The one deferred (not rejected)
  widening: a no-op-default observability tap anchored to two documented bug
  classes (post-Stop write storms, edit count-drift). Add it when next
  diagnosing either; day-one it is dead surface.
- **A telemetry/warn port.** `console.warn` + Sentry are ambient across the
  codebase; injecting them here alone would be inconsistent ceremony.

## Consequences

- The interface is the test surface. The lean suite (five tests, not fifty):
  1. handoff loud-miss — `finalize` without `captureFinish` warns + Sentry +
     still completes with part-counted fallback;
  2. terminal ordering — approval-settle → flush → mark, assert call order
     with deferred fakes; abort variant marks aborted, never rejects;
  3. `prepare()` error mapping — regen×approvals 400, arg-validation 400,
     concurrency error passes through;
  4. guest inertness — full lifecycle, zero `fetchMutation` calls, identity
     passthrough;
  5. `fail()` at each phase — pre-prepare no-op, post-prepare marks failed,
     never throws.
- Chat-turn-runtime tests get a hand-written fake (call-ledger object)
  instead of faking 11 branches; existing snapshot-tracker/transform tests
  survive as internals tests.
- Implementation-time cautions: relocate the Selected path token /
  edit-regen guard args verbatim (the known count-drift edge, ADR-0006 risk
  c); the guest identity answer requires the post-validation array — keep
  `uiStreamIdentity` a method, not a getter; the module also sanitizes guest
  history so `prepare()` returns THE canonical history in both modes and the
  parent's second sanitize call dies.
- `durable-runtime.ts` is absorbed; its exports stop leaking into the Chat
  turn runtime's import list.
