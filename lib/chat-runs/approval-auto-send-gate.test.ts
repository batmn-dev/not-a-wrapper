import { afterEach, describe, expect, it } from "vitest"
import {
  clearLocallyResolvedApprovals,
  markApprovalResolvedLocally,
  messageHasLocallyResolvedApproval,
} from "./approval-auto-send-gate"

// Layer 3 of the continuation idempotency (gameplan §10): whatever the SDK
// does with its predicate on hydration, ADOPTED approval-responded parts can
// never arm auto-send — only a part this tab resolved can.

function approvalRespondedMessage(approvalId: string) {
  return {
    parts: [
      {
        type: "tool-send_email",
        state: "approval-responded",
        approval: { id: approvalId, approved: true },
      },
    ],
  }
}

afterEach(() => {
  clearLocallyResolvedApprovals()
})

describe("approval auto-send gate", () => {
  it("blocks approval-responded parts adopted from the server", () => {
    expect(
      messageHasLocallyResolvedApproval(approvalRespondedMessage("approval_1"))
    ).toBe(false)
  })

  it("allows exactly the approvals this tab resolved", () => {
    markApprovalResolvedLocally("approval_1")
    expect(
      messageHasLocallyResolvedApproval(approvalRespondedMessage("approval_1"))
    ).toBe(true)
    expect(
      messageHasLocallyResolvedApproval(approvalRespondedMessage("approval_2"))
    ).toBe(false)
  })

  it("ignores non-approval parts and malformed shapes", () => {
    markApprovalResolvedLocally("approval_1")
    expect(
      messageHasLocallyResolvedApproval({
        parts: [{ type: "text", text: "hi" }, { state: "approval-requested" }],
      })
    ).toBe(false)
    expect(messageHasLocallyResolvedApproval({})).toBe(false)
  })
})
