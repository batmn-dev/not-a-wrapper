# 11. Durable turn settlement: execution grants, a lifecycle binding, and receipts that never reject delivery

- Status: accepted
- Date: 2026-07-18
- Context: Architecture deepening — Candidate 2 of the 2026-07-18 review;
  direct remediation of
  `docs/chat-turn-token-expiry-orphaned-run-incident-2026-07-14.md`
- Related: ADR-0006 (Chat turn runtime — intact), ADR-0009 (Durable turn
  runtime — **three decisions superseded below, the rest intact**), ADR-0008
  (no stream-resume read surface — intact)

## Context

The 2026-07-14 incident proved that one failed write could destroy three
independent facts at once: the model completed a 3,692-character answer
(delivery), the answer was never durably preserved (persistence), and the UI
showed `Finished / Done` (presentation truth). The mechanism: the route
captured the user's WorkOS access token once and reused it as the worker
credential for the whole run; the token expired mid-generation; the awaited
`markGenerationRunCompleted` in `finalize()` rejected; the rejection failed
the response pipe; the client kept no copy; the run stayed `streaming`
forever.

Both halves of that mechanism were *accepted* ADR-0009 consequences, not
bugs: "the convex token crosses here, once" and "may reject on
completion-write failure (today's envelope semantics)". Fixing the incident
class therefore requires superseding those decisions, not patching around
them.

Three interface designs were compared (minimal `signal`/`settle`, an AI SDK
lifecycle binding, a caller-first stream wrapper). The minimal design
re-creates the two-callback choreography ADR-0009 killed; the stream wrapper
moves UI-stream conversion into settlement, violating ADR-0006's decision
that the envelope stays in the parent closure. The lifecycle binding —
Design 2 — keeps both AI SDK callback positions visible in `toResponse()`
while hiding settlement ordering, worker authority, and retry policy.

## Decision

Deepen the **Durable turn runtime** into **Durable turn settlement**
(`app/api/chat/durable-turn-runtime.ts`), with three coordinated changes:

### 1. Execution grant — run-scoped worker authority

The user's Convex token authorizes exactly one call: `prepareGeneration`
(admission). ADR-0020 additionally requires the Next.js server's signed
admission proof before Convex accepts that call. At construction the Convex
adapter mints a 32-byte random
**execution grant** secret; its SHA-256 digest rides the admission call and
is stored on the `generationRuns` row (`grantDigest`, `grantExpiresAt` =
now + 60 min). Every post-prepare write travels the **Durable worker wire**:
a POST to the Convex HTTP action `/chat-turn/worker` with
`Authorization: Bearer <secret>`.

- The HTTP action (`convex/http.ts`) hashes the presented secret **before
  dispatch** (pure-TS `sha256Hex`, `convex/lib/sha256.ts` — identical in
  every Convex runtime), so the raw secret never appears in a mutation
  argument or function log. It dispatches to grant-authorized internal
  mutations in `convex/chatRuntimeWorker.ts`.
- Each internal mutation re-verifies transactionally
  (`requireGrantAuthorizedRun`): digest match (constant-time hex compare),
  expiry, and exact run → chat → user linkage. It then reconstructs the same
  `AuthenticatedRunOwner` the user-token wrappers inject and calls the
  existing `...ForChat` handlers — **one policy, two authenticators**. Wrong
  digest and missing run collapse to one error; expiry is distinct (legit
  workers need the telemetry).
- The raw secret exists only in the Next server process's memory. It is
  never sent to the browser, logged, or persisted.
- Revocation is expiry plus the existing status guards: writes to a terminal
  run are already no-ops under first-terminal-wins, so a post-settlement
  grant authorizes nothing but idempotent no-ops.

### 2. The AI SDK lifecycle binding (Design 2)

`streamTextExtras()` / `onChunk` / `recordStep` / `noteStreamError` /
`onStreamAbort` / `captureFinish` / `uiStreamIdentity` / `finalize` collapse
into one one-shot `bind(toolFacts): DurableStreamBinding`, grouped by AI SDK
position:

```ts
const lifecycle = durableTurn.bind(tool)
streamText({ ...options, ...lifecycle.streamTextExtras })   // + stream.* calls
toUIMessageStream({
  ...lifecycle.envelope.identity(validatedMessages),
  onEnd: (outcome) => lifecycle.envelope.settle(outcome),
})
```

Both onEnd layers remain in `toResponse()`'s closure (ADR-0006 intact).
This deliberately reverses ADR-0009's rejection of "SDK-callback method
names" for the *grouping* (`stream.*` / `envelope.*` mirror the two AI SDK
seams); the method names themselves stay intent-named (`recordStep`,
`settle`). `prepare()` and `fail()` stay on the runtime — `fail()` remains
legal at any phase.

### 3. Settlement — a typed receipt that never rejects delivery

`settle()` owns the load-bearing order and ALWAYS resolves:

1. `allSettled(approvalWritePromises)` → snapshot flush (as before);
2. **final full-parts snapshot** (`flushFinal`): an unconditional snapshot
   carrying the response message's COMPLETE parts — tool parts included,
   which the throttled text/reasoning snapshots never carry — sequenced
   after every throttled write. Because `updateAssistantSnapshot` also lands
   `content`/`parts` on the assistant message doc, the full answer survives
   a failed terminal write;
3. the loud-miss fallback (`durable_finish_handoff_missed` warn + Sentry
   before `countToolParts`) — unchanged from ADR-0009;
4. the terminal transition with **bounded retry**
   (`settleRetryDelaysMs`, default `[250, 1000]` → three attempts);
5. a typed receipt:

```ts
type DurableSettlementReceipt =
  | { status: "confirmed"; runId; outcome: "completed" | "aborted" }
  | { status: "degraded"; runId; reason: string }
  | { status: "guest" }
```

A degraded completion logs `durable_settlement_degraded` + Sentry (level
error) inside the module; the response pipe finishes cleanly. The run then
remains live until the existing supersede sweep closes it honestly — it is
NOT relabeled completed.

### Client contract (deliberate non-change)

Durable-chat content preservation is server-owned. The client's durable read
path consults ONLY the Convex subscription (`messages/provider.tsx` reads
IndexedDB solely for localOnly chats), so no client-side recovery copy is
written — a dormant copy nothing reads would be dead surface, and an active
one recreates the split-brain the incident doc warns about. The rule is now
documented at the seam (`lib/chat-turn/turn-store.ts`). The remaining loss
window — Convex entirely unreachable for the whole settlement tail while
the stream delivered fine — is accepted and observable
(`durable_settlement_degraded`).

## Supersessions of ADR-0009 (exactly three)

1. **Captured-token worker writes** ("the convex token crosses here, once"):
   the token now authorizes admission only; worker writes use the execution
   grant. A mid-run token expiry can no longer reject a worker write.
2. **Rejecting finalize** ("may reject on completion-write failure"):
   settlement never rejects; persistence failure is a typed degraded
   receipt, and answer delivery is independent of terminal persistence.
3. **The direct `fetchMutation` wire for post-prepare writes** (ADR-0009
   §Ports "Convex wire: direct"): post-prepare writes travel the
   `DurableWorkerWire` (HTTP + Bearer). **The wire is the new test seam** —
   tests inject a recording wire (`deps.workerWire` /
   `ChatTurnDeps.durableWorkerWire`); `fetchMutation` fakes now see exactly
   one call (`prepareGeneration`).

Everything else in ADR-0009 stands: the selecting factory and inert guest
adapter (now returning the `guest` receipt), the `ToolFacts` port, the
loud-miss contract, await discipline in return types, no client-side
double-terminal dedup, and both onEnd layers in one closure.

## Deferred (not rejected)

- **Heartbeat lease + cron reaper**: `settle()`'s contract does not depend
  on lease infrastructure; time-based reaping of runs on abandoned chats is
  the next phase. It must route through `applyLifecycleVerdict` and the
  status projection (run-id guard intact) so the sidebar clears correctly.
- **Shared run-presentation resolver** ("no failure recorded" must never
  render `Finished`): a separate deep module per the accepted review; the
  receipt and the preserved content are its inputs.
- **Grant revocation on terminal transition**: expiry + status guards bound
  the exposure today; explicit digest clearing would touch the lifecycle
  verdict machinery for marginal gain.
- A generalized write journal or adapter framework: nothing needs it yet.

## Consequences

- The ops vocabulary gains `durable_final_snapshot_write_failed`,
  `durable_completion_write_failed` (per attempt), and
  `durable_settlement_degraded`; the ADR-0009 tags survive verbatim.
- The interface is the test surface: settlement ordering + final full-parts
  snapshot, degraded receipts on exhausted retries (settle resolves), grant
  minting on the admission call, guest receipt, `fail()` at each phase
  (`durable-turn-runtime.test.ts`); grant verification vectors
  (`convex/chatRuntimeWorker.test.ts`).
- `maxDuration`, deadline ordering, and tool-budget hardening from the
  incident doc are out of scope here and remain open.
