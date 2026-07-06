# 8. The Convex chat runtime has no stream-resume read surface

- Status: accepted
- Date: 2026-07-05
- Context: Architecture deepening — generation runtime core; branch
  `darknight/bat-signal-20260705-133514`
- Related: ADR-0006 (Chat turn runtime — the HTTP side of this wire),
  ADR-0001 (client renders the server-selected path — how reconnect
  actually works)

## Context

The original durable-persistence drop (PR #65, `e2e3892`) shipped
`convex/chatRuntime.ts` with a read/recovery surface designed for a
stream-resume feature that was never built: `getRecoverableChatState`,
`listStreamDeltasForRun`, `listActiveRunsForChat`,
`listMessagesForChatPaginated`, plus write-path spares
(`createGenerationRun`, `markGenerationRunRunning`, `appendStreamDelta`,
`markGenerationRunAwaitingApproval`) and a `chatVersion` field stored on
every generation run.

A verified caller sweep (2026-07-05) found none of these had ever been
called from the real Convex module's consumers — the only historical
references were the duplicate UI Convex source tree removed in `ef530c6`.
Reconnect does not need them: a client that reloads mid-stream renders the
durable message docs through the branch projection (ADR-0001); the
mid-stream state it sees comes from `updateAssistantSnapshot` patching the
message doc itself, not from replaying snapshot rows. 8 of 21 public
functions were interface with no behaviour behind it — including four
publicly callable queries that widened the auth-review surface for
nothing.

## Decision

Delete the unwired surface. The Convex chat runtime module's public
interface is exactly the lifecycle the Chat turn runtime drives —
`prepareGeneration`, `updateAssistantSnapshot`, `recordToolInvocations`,
`createToolApprovalRequest`, `markGenerationRunCompleted`,
`markGenerationRunFailed`, `markGenerationRunAborted` — plus the two
client approval actions (`approveToolCall`, `denyToolCall`).

Stream resume is **descoped, not deferred**: reconnect works by rendering
durable message docs, and any future resume feature must re-justify its
own read surface against that baseline (it would likely subscribe to the
message doc, not replay `assistantMessageSnapshots` rows).

`chatVersion` is no longer sent by the Chat turn runtime nor stored on
generation runs (it was written and never read — the telemetry that uses
the request's chat version reads the runtime-local value, not the stored
field). Because the database is pre-launch, the generation-runs schema
drops the field directly instead of carrying a migration placeholder.

`app/api/chat/search-tools.ts` (superseded by the Tool runtime's
`policySummary.searchInjected`) is deleted with its test.

## Consequences

- The module's interface matches its behaviour: 9 public functions are
  exercised in production. Seven Chat-turn-driven mutations route through
  their `*ForChat` handlers; the two client approval mutations
  (`approveToolCall`, `denyToolCall`) are direct client-facing handlers.
- `assistantMessageSnapshots` remains written (throttled) but its only
  readers are now internal: the write-path sequence dedupe and the
  regeneration-reuse probe in `applyTerminalAssistantOutcome`. Whether
  the append-only rows are still worth their write cost — vs. a
  `hasStreamedOutput` flag on the run — is a known follow-up, deliberately
  NOT taken here because it touches the terminal-outcome-stub edge.
- A future architecture pass finding "no recovery reads" should treat
  that as this decision, not as a gap.
