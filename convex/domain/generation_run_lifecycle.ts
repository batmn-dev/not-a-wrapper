import {
  isActiveGenerationRunStatus,
  isTerminalGenerationRunStatus,
} from "./message_contract"
import type { GenerationRunStatus } from "./message_contract"
import { isWorkerExecutingStatus } from "./generation_run_liveness"

/**
 * Generation run lifecycle — the single pure brain owning the legal transitions
 * of a Generation run and its paired assistant message.
 *
 * Mutation handlers in chatRuntime.ts gather facts and apply patches; they do
 * not re-derive legality. `resolveGenerationRunTransition` maps (current facts,
 * signal) → verdict, and the verdict names the run patch plus the message
 * resolution. The race rules live here, in one table:
 *
 *  - First terminal outcome wins.
 *  - `fail` may overwrite `completed` (the onError-vs-envelope race must
 *    converge to failed) but never `aborted` (a user Stop is settled).
 *  - `complete` downgrades to `awaiting_approval` while approvals pend.
 *  - `supersede` reaches only queued/running/streaming (paused runs are closed
 *    by deny-pending at next-turn prepare, never swept).
 *
 * No MutationCtx, no db access: operates on plain fact records and message
 * status values (mirrors ./message_visibility).
 */
export type LifecycleSignal =
  | { kind: "complete"; hasPendingApprovals: boolean }
  | { kind: "fail"; error: string }
  | { kind: "abort"; reason?: string }
  | { kind: "supersede"; reason: string }
  | { kind: "approval-requested" }
  | { kind: "approvals-resolved"; anyDenied: boolean }
  // Durable-turn control signals: an authenticated user Stop,
  // the lease reaper failing a dead worker's run, and the approval reaper
  // expiring an unattended pause.
  | { kind: "stop"; reason?: string }
  | { kind: "lease-expired" }
  | { kind: "approval-expired" }
  // The resolved-approvals reaper settling a pause whose approvals were all
  // resolved but whose continuation never dispatched (the client crashed or
  // reloaded before auto-send). `anyDenied` mirrors approvals-resolved: a
  // denied strand closes aborted, an approved strand closes failed (the tool
  // never ran, so "completed" would be a lie).
  | { kind: "continuation-lost"; anyDenied: boolean }

/**
 * Why a run reached its terminal status — durable audit vocabulary carried on
 * the run doc and the selected-conversation projection. Stamped
 * by every settling transition below; the approvals-resolved close leaves it
 * unset for the denied case (no member of this union describes it, and
 * inventing one is worse than an optional).
 */
export type GenerationRunTerminalReason =
  | "completed"
  | "user_stop"
  | "superseded"
  | "provider_error"
  | "lease_expired"
  | "approval_expired"
  | "continuation_lost"
  | "request_aborted"

/**
 * Facts about the assistant message a terminal transition resolves against,
 * gathered by the handler (see `gatherAssistantMessageFacts` in chatRuntime.ts)
 * so this module stays pure.
 */
export type AssistantMessageFacts = {
  hasSemanticParts: boolean
  // message.createdAt < run.startedAt — a regeneration streaming into an older,
  // reused message rather than a fresh sibling.
  isReusedForRegeneration: boolean
  // any assistantMessageSnapshots row exists for this run (only meaningful, and
  // only worth querying, when isReusedForRegeneration).
  hasSnapshotForRun: boolean
  // the semantic sibling to revert to, precomputed — preferring the branch a
  // regeneration forked from (regenerationSourceMessageId), else the latest.
  fallbackSiblingId: string | null
}

export type MessageResolution =
  | { kind: "none" }
  | {
      kind: "stamp"
      status: "completed" | "failed" | "aborted" | "awaiting_approval"
      error?: string
    }
  // Terminal outcome stub: an empty message KEPT (not deleted) with a terminal
  // status when a run dies before producing content and no sibling exists.
  | { kind: "keep-stub"; status: "failed" | "aborted"; error?: string }
  | { kind: "delete-and-reselect"; siblingId: string }
  | { kind: "restore-completed" }

export type LifecycleIgnoreReason =
  | "already-terminal"
  | "not-supersedable"
  | "not-awaiting-approval"
  // lease-expired probes a run that is not queued/running/streaming — an
  // awaiting_approval pause holds no lease, so the lease reaper must not
  // touch it (the approval reaper owns that expiry).
  | "not-worker-executing"

export type LifecycleVerdict<M extends MessageResolution = MessageResolution> =
  | {
      kind: "ignore"
      reason: LifecycleIgnoreReason
    }
  | {
      kind: "transition"
      run: {
        status: GenerationRunStatus
        error?: string
        // clear the run's activeStreamId — every terminal transition and the
        // complete→awaiting_approval downgrade; approval-requested does NOT.
        clearActiveStream: boolean
        // stamp completedAt — all terminal transitions settle; awaiting_approval
        // (from either a pending completion or an approval request) does not.
        settle: boolean
        // durable audit vocabulary; present exactly when the transition settles
        // (except the approvals-resolved denied close — see the type's doc).
        terminalReason?: GenerationRunTerminalReason
      }
      message: M
    }

type TerminalOutcome = { status: "failed" | "aborted"; error?: string }

/**
 * Empty-placeholder outcome policy. Order matters — first match wins (mirrors
 * the pre-extraction `applyTerminalAssistantOutcome` exactly):
 *
 *  1. a regeneration that reused an older message and died before its first
 *     snapshot, while the message still carries the prior semantic parts →
 *     restore it to "completed" (the reused answer was never actually replaced);
 *  2. an empty message with a semantic sibling (a regeneration died before its
 *     first chunk) → delete the placeholder and re-select the sibling, so the
 *     turn reverts to the answer the user was viewing — preferring the branch
 *     the regeneration forked from, not the newest sibling;
 *  3. an empty message with no sibling (a fresh send died) → KEEP it as a
 *     Terminal outcome stub marked with the terminal status. Deleting it here is
 *     what made failed turns invisible: the user message read as silently
 *     unanswered and got re-sent as duplicate history the model then re-answered.
 *     The stub renders as an inline failed/stopped state with retry and projects
 *     into model history as an explicit "never answered" marker;
 *  4. a message with semantic parts → stamp the terminal status, keeping content.
 */
export function resolveTerminalAssistantMessageResolution(
  facts: AssistantMessageFacts,
  outcome: TerminalOutcome
): MessageResolution {
  if (
    facts.isReusedForRegeneration &&
    !facts.hasSnapshotForRun &&
    facts.hasSemanticParts
  ) {
    return { kind: "restore-completed" }
  }
  if (!facts.hasSemanticParts && facts.fallbackSiblingId) {
    return { kind: "delete-and-reselect", siblingId: facts.fallbackSiblingId }
  }
  if (!facts.hasSemanticParts) {
    return { kind: "keep-stub", status: outcome.status, error: outcome.error }
  }
  return { kind: "stamp", status: outcome.status, error: outcome.error }
}

function ignore(reason: LifecycleIgnoreReason): LifecycleVerdict {
  return { kind: "ignore", reason }
}

// The terminal signals (fail/abort/supersede) share one message half — the
// empty-placeholder policy above — but resolve against `null` facts (an
// unresolvable message) as a no-op.
function terminalMessage(
  facts: AssistantMessageFacts | null,
  outcome: TerminalOutcome
): MessageResolution {
  return facts
    ? resolveTerminalAssistantMessageResolution(facts, outcome)
    : { kind: "none" }
}

/**
 * The one transition table. `current.message` carries the assistant-message
 * facts for signals whose message half is the terminal policy (fail/abort/
 * supersede); it may be `null` for signals that stamp a fixed status or leave
 * the message to another owner (complete/approval-requested/approvals-resolved).
 *
 * The overloads narrow the verdict for the two signals whose message half is
 * always a stamp, so call sites read `verdict.message.status` directly instead
 * of guarding a branch the table never produces.
 */
export function resolveGenerationRunTransition(
  current: { runStatus: unknown; message: AssistantMessageFacts | null },
  signal: Extract<LifecycleSignal, { kind: "complete" | "approval-requested" }>
): LifecycleVerdict<Extract<MessageResolution, { kind: "stamp" }>>
export function resolveGenerationRunTransition(
  current: { runStatus: unknown; message: AssistantMessageFacts | null },
  signal: LifecycleSignal
): LifecycleVerdict
export function resolveGenerationRunTransition(
  current: { runStatus: unknown; message: AssistantMessageFacts | null },
  signal: LifecycleSignal
): LifecycleVerdict {
  const { runStatus, message } = current

  switch (signal.kind) {
    case "complete": {
      // A terminal outcome is written once. The response envelope's onFinish
      // fires for ERRORED streams too (isAborted false), racing the stream
      // onError's failed write — without this guard the empty "completion"
      // repaints a failed run as completed and hides the turn's failed stub.
      if (!isActiveGenerationRunStatus(runStatus)) {
        return ignore("already-terminal")
      }
      const status = signal.hasPendingApprovals
        ? "awaiting_approval"
        : "completed"
      return {
        kind: "transition",
        run: {
          status,
          clearActiveStream: true,
          settle: status === "completed",
          terminalReason: status === "completed" ? "completed" : undefined,
        },
        message: { kind: "stamp", status },
      }
    }
    case "fail": {
      // Failed may overwrite "completed" — the response envelope's completion
      // write races the stream onError on an errored stream, and both orders
      // must converge to failed. It must NOT overwrite "aborted": a user Stop
      // is a settled outcome a late failure signal may not repaint.
      if (
        !isActiveGenerationRunStatus(runStatus) &&
        runStatus !== "completed"
      ) {
        return ignore("already-terminal")
      }
      return {
        kind: "transition",
        run: {
          status: "failed",
          error: signal.error,
          clearActiveStream: true,
          settle: true,
          terminalReason: "provider_error",
        },
        message: terminalMessage(message, {
          status: "failed",
          error: signal.error,
        }),
      }
    }
    case "abort": {
      // First terminal outcome wins: the streamText onAbort and the response
      // envelope's isAborted finish both write aborted (benign), but a run that
      // already settled as failed/completed must not be repainted.
      if (!isActiveGenerationRunStatus(runStatus)) {
        return ignore("already-terminal")
      }
      return {
        kind: "transition",
        run: {
          status: "aborted",
          error: signal.reason,
          clearActiveStream: true,
          settle: true,
          terminalReason: "request_aborted",
        },
        message: terminalMessage(message, {
          status: "aborted",
          error: signal.reason,
        }),
      }
    }
    case "stop": {
      // The authenticated durable Stop has the same reach as abort:
      // active statuses INCLUDING awaiting_approval (a Stop may close a
      // paused run; the handler denies its pending approvals in the same
      // transaction). First terminal wins; a settled run returns its
      // canonical result via ignore.
      if (!isActiveGenerationRunStatus(runStatus)) {
        return ignore("already-terminal")
      }
      return {
        kind: "transition",
        run: {
          status: "aborted",
          error: signal.reason ?? "stopped by user",
          clearActiveStream: true,
          settle: true,
          terminalReason: "user_stop",
        },
        message: terminalMessage(message, {
          status: "aborted",
          error: signal.reason ?? "stopped by user",
        }),
      }
    }
    case "lease-expired": {
      // The lease reaper fails a run whose worker died. Only
      // worker-executing statuses hold a lease: an awaiting_approval pause is
      // lease-free (the approval reaper owns its expiry), and a terminal run
      // is settled. Partial content is preserved by the terminal message
      // policy; a dead worker's run becomes failed, never fake-completed.
      if (isTerminalGenerationRunStatus(runStatus)) {
        return ignore("already-terminal")
      }
      if (!isWorkerExecutingStatus(runStatus)) {
        return ignore("not-worker-executing")
      }
      return {
        kind: "transition",
        run: {
          status: "failed",
          error: "generation worker lease expired",
          clearActiveStream: true,
          settle: true,
          terminalReason: "lease_expired",
        },
        message: terminalMessage(message, {
          status: "failed",
          error: "generation worker lease expired",
        }),
      }
    }
    case "approval-expired": {
      // The approval reaper settles a pause nobody resolved.
      // Only awaiting_approval holds an approval expiry; anything else is
      // either settled or a misrouted signal.
      if (runStatus !== "awaiting_approval") {
        return ignore(
          isActiveGenerationRunStatus(runStatus)
            ? "not-awaiting-approval"
            : "already-terminal"
        )
      }
      return {
        kind: "transition",
        run: {
          status: "failed",
          error: "tool approval expired",
          clearActiveStream: true,
          settle: true,
          terminalReason: "approval_expired",
        },
        message: terminalMessage(message, {
          status: "failed",
          error: "tool approval expired",
        }),
      }
    }
    case "continuation-lost": {
      // The resolved-approvals reaper (chatRuntime's
      // reapResolvedApprovalPausesPass) settles a pause whose approvals are
      // all resolved but whose continuation never dispatched. Only
      // awaiting_approval qualifies: any other status means either the
      // continuation DID prepare (its approvals-resolved close settled the
      // pause) or another terminal writer won — both are left alone, so this
      // signal can never resurrect or repaint a stopped run.
      if (runStatus !== "awaiting_approval") {
        return ignore(
          isActiveGenerationRunStatus(runStatus)
            ? "not-awaiting-approval"
            : "already-terminal"
        )
      }
      const status = signal.anyDenied ? "aborted" : "failed"
      return {
        kind: "transition",
        run: {
          status,
          error: "approval continuation was not dispatched",
          clearActiveStream: true,
          settle: true,
          terminalReason: "continuation_lost",
        },
        message: terminalMessage(message, {
          status,
          error: "approval continuation was not dispatched",
        }),
      }
    }
    case "supersede": {
      // Supersede reaches only queued/running/streaming. A paused
      // (awaiting_approval) run is closed by deny-pending at the next turn's
      // prepare, never by the sweep — so the sweep leaves it alone.
      if (!isSupersedableGenerationRunStatus(runStatus)) {
        return ignore("not-supersedable")
      }
      return {
        kind: "transition",
        run: {
          status: "aborted",
          error: signal.reason,
          clearActiveStream: true,
          settle: true,
          terminalReason: "superseded",
        },
        message: terminalMessage(message, {
          status: "aborted",
          error: signal.reason,
        }),
      }
    }
    case "approval-requested": {
      // A tool-approval request pauses an ACTIVE run. A late request landing on
      // an already-settled run (a user Stop mid-stream) is ignored — it must not
      // repaint the run awaiting_approval, which is not supersedable and would
      // zombie until the next turn's deny-pending pass. Unlike a completion, the
      // pause keeps activeStreamId and does not settle.
      if (!isActiveGenerationRunStatus(runStatus)) {
        return ignore("already-terminal")
      }
      return {
        kind: "transition",
        run: {
          status: "awaiting_approval",
          clearActiveStream: false,
          settle: false,
        },
        message: { kind: "stamp", status: "awaiting_approval" },
      }
    }
    case "approvals-resolved": {
      // The continuation turn closes the paused run once its approvals resolve.
      // A run already settled (aborted by a racing Stop, or completed) is left
      // alone. A queued/running/streaming run never reached the approval pause,
      // so a stale or misrouted response must not settle it. The continuation
      // owns a NEW run and message, so the message half is none.
      if (runStatus !== "awaiting_approval") {
        return ignore(
          isActiveGenerationRunStatus(runStatus)
            ? "not-awaiting-approval"
            : "already-terminal"
        )
      }
      return {
        kind: "transition",
        run: {
          status: signal.anyDenied ? "aborted" : "completed",
          clearActiveStream: true,
          settle: true,
          terminalReason: signal.anyDenied ? undefined : "completed",
        },
        message: { kind: "none" },
      }
    }
  }
}

// Minimal signal per kind, used only to probe the ignore half of a rule. The
// payload fields never influence whether a signal is ignored — only what the
// resulting transition writes.
const probeSignals: Record<LifecycleSignal["kind"], LifecycleSignal> = {
  complete: { kind: "complete", hasPendingApprovals: false },
  fail: { kind: "fail", error: "" },
  abort: { kind: "abort" },
  supersede: { kind: "supersede", reason: "" },
  "approval-requested": { kind: "approval-requested" },
  "approvals-resolved": { kind: "approvals-resolved", anyDenied: false },
  stop: { kind: "stop" },
  "lease-expired": { kind: "lease-expired" },
  "approval-expired": { kind: "approval-expired" },
  "continuation-lost": { kind: "continuation-lost", anyDenied: false },
}

/**
 * Cheap gate: would `kind` on a run in `runStatus` resolve to ignore? The
 * ignore half of every rule reads only the run status — never the message
 * facts or the signal payload — so handlers may check this BEFORE paying the
 * fact-gathering reads (the double-terminal races are exactly the paths where
 * those reads are wasted). `resolveGenerationRunTransition` stays authoritative;
 * this is a projection of its ignore column, not a second table.
 */
export function isIgnoredSignal(
  runStatus: unknown,
  kind: LifecycleSignal["kind"]
): boolean {
  return (
    resolveGenerationRunTransition(
      { runStatus, message: null },
      probeSignals[kind]
    ).kind === "ignore"
  )
}

// Lifecycle vocabulary, not chatRuntime plumbing — supersedable run statuses are
// the pre-terminal, pre-pause states the sweep may close.
export function isSupersedableGenerationRunStatus(status: unknown): boolean {
  return status === "queued" || status === "running" || status === "streaming"
}

// A message is supersedable while its own status is still live (a run that never
// reached a terminal mark). Terminal statuses — completed answers and first-class
// failed/aborted stubs alike — are settled turns the sweep must not restate.
export function isSupersedableMessageStatus(status: unknown): boolean {
  return status === "submitted" || status === "streaming"
}
