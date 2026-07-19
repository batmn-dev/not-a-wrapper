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

/** Test seam. */
export function clearLocallyResolvedApprovals(): void {
  locallyResolvedApprovalIds.clear()
}
