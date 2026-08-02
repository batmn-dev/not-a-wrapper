import { describe, expect, it } from "vitest"
import { presentChatStreamError } from "./public-chat-error"

describe("presentChatStreamError", () => {
  it("swallows a lost approval-continuation race by structured code", () => {
    const error = new Error(
      JSON.stringify({
        error: "Approval continuation already dispatched",
        code: "APPROVAL_CONTINUATION_CONFLICT",
      })
    )
    expect(presentChatStreamError(error)).toEqual({
      kind: "swallow",
      reason: "approval-continuation-lost-race",
    })
  })

  it("surfaces an unresolved approval with the server's actionable message", () => {
    const error = new Error(
      JSON.stringify({
        error: "Your approval decision was not recorded. Approve or deny it again.",
        code: "APPROVAL_UNRESOLVED",
      })
    )
    expect(presentChatStreamError(error)).toEqual({
      kind: "toast",
      title: "Your approval decision was not recorded. Approve or deny it again.",
    })
  })

  it("falls back to a generic title for opaque transport errors", () => {
    expect(presentChatStreamError(new Error("fetch failed"))).toEqual({
      kind: "toast",
      title: "Something went wrong. Please try again.",
    })
    expect(presentChatStreamError(new Error("Failed to fetch"))).toEqual({
      kind: "toast",
      title: "Something went wrong. Please try again.",
    })
    expect(presentChatStreamError(new Error("Rate limit exceeded"))).toEqual({
      kind: "toast",
      title: "Rate limit exceeded",
    })
  })
})
