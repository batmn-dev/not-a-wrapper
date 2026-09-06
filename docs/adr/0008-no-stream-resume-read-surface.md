# 8. The Convex chat runtime has no stream-resume read surface

- Status: accepted for removal of unused Convex APIs; no-resume policy superseded
- Amended by ADR-0039 (2026-09-05): reconnect uses retained Redis UI chunks;
  the removed Convex delta/read APIs remain removed.
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

The original decision descoped stream resume in favor of rendering durable
message docs. [ADR-0039](0039-resumable-generation-stream.md) supersedes that
exclusion with an authenticated retained Redis stream. Durable message docs
remain the checkpoint fallback; the unused Convex delta/read APIs stay removed.

`chatVersion` remains a request-local input for telemetry and tool-call
diagnostics, but it is not stored on generation runs.

`app/api/chat/search-tools.ts` (superseded by the Tool runtime's
`policySummary.searchInjected`) is deleted with its test.

## Consequences

- The module's interface matches its behaviour: 9 public functions are
  exercised in production. Seven Chat-turn-driven mutations route through
  their `*ForChat` handlers; the two client approval mutations
  (`approveToolCall`, `denyToolCall`) are direct client-facing handlers.
- Durable message docs carry projected output. `lastSnapshotSequence` on the
  generation run rejects stale checkpoints and records whether a reused
  regeneration produced output; no append-only snapshot table is retained.
- Recovery now combines the retained-stream read in ADR-0039 with durable
  message projection. The removed Convex reads are still intentionally absent.
