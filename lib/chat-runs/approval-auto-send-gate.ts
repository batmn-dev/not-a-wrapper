/**
 * Approval-continuation idempotency, layer 3 of 3 (durable-turn gameplan §10,
 * PR 8): only the tab that LOCALLY resolved an approval may arm the AI SDK's
 * `sendAutomaticallyWhen` continuation. Approval-responded parts adopted from
 * the server (another tab resolved, or hydration re-installed a resolved
 * history) never auto-send — regardless of whether the SDK evaluates its
 * predicate on `setMessages` hydration, this gate makes the answer "no
 * dispatch" by construction. The server's `continuationRunId` check and the
 * route's structured 409 are layers 1 and 2 behind it.
 *
 * Module-scoped by design: the resolution click and the transport binding
 * live in different hooks, and the fact "this browser tab resolved approval X"
 * is tab-global, not per-binding.
 */

const locallyResolvedApprovalIds = new Set<string>()

/** Record that THIS tab resolved the approval (called on the click path). */
export function markApprovalResolvedLocally(approvalId: string): void {
  locallyResolvedApprovalIds.add(approvalId)
}

type MessagePartLike = {
  state?: string
  approval?: { id?: unknown }
}

/**
 * True when the message carries at least one approval-responded part whose
 * approval id was resolved by THIS tab.
 */
export function messageHasLocallyResolvedApproval(message: {
  parts?: unknown[]
}): boolean {
  for (const part of message.parts ?? []) {
    const candidate = part as MessagePartLike
    if (candidate?.state !== "approval-responded") continue
    const approvalId = candidate.approval?.id
    if (
      typeof approvalId === "string" &&
      locallyResolvedApprovalIds.has(approvalId)
    ) {
      return true
    }
  }
  return false
}

/**
 * One-shot arm: when the auto-send predicate fires, the matched approval ids
 * are CONSUMED — the resolution authorizes exactly one continuation dispatch.
 * A later remount that rehydrates the same approval-responded parts (still
 * present until the continuation lands) finds the gate closed, so reopening
 * or reloading never submits another model request (gameplan §19 checklist).
 * Returns the consumed ids (empty = gate closed, auto-send must not arm).
 *
 * The caller MUST pair this with `restoreLocallyResolvedApprovals` when the
 * armed dispatch ERRORS: the SDK does not re-evaluate its predicate on error,
 * the approval is already resolved durably (the reaper only expires PENDING
 * rows), and without restoration the consumed authorization is the last one —
 * the continuation would be stranded with no recovery path. Restoring re-arms
 * the next evaluation (a reload/remount recovers the dispatch); a duplicate
 * from a lost race is absorbed by the server's structured 409.
 */
export function consumeLocallyResolvedApprovals(message: {
  parts?: unknown[]
}): string[] {
  const consumed: string[] = []
  for (const part of message.parts ?? []) {
    const candidate = part as MessagePartLike
    if (candidate?.state !== "approval-responded") continue
    const approvalId = candidate.approval?.id
    if (
      typeof approvalId === "string" &&
      locallyResolvedApprovalIds.delete(approvalId)
    ) {
      consumed.push(approvalId)
    }
  }
  return consumed
}

/** Re-arm after a failed armed dispatch (see consume's doc). */
export function restoreLocallyResolvedApprovals(approvalIds: string[]): void {
  for (const approvalId of approvalIds) {
    locallyResolvedApprovalIds.add(approvalId)
  }
}

/** Test seam. */
export function clearLocallyResolvedApprovals(): void {
  locallyResolvedApprovalIds.clear()
}
