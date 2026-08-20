import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import { PublicChatHttpError } from "./public-http-error"
import {
  createErrorResponse,
  excludeSystemRoleMessages,
  isConvexArgumentValidationError,
  toInvalidDurableRequestError,
} from "./utils"

describe("isConvexArgumentValidationError", () => {
  it("matches Convex argument-validation rejections and nothing else", () => {
    const convexShape = new Error(
      '[Request ID: abc123] Server Error\nArgumentValidationError: Value does not match validator.\nPath: .chatId\nValue: "smoke"\nValidator: v.id("chats")'
    )
    expect(isConvexArgumentValidationError(convexShape)).toBe(true)
    expect(isConvexArgumentValidationError(new Error("stream aborted"))).toBe(
      false
    )
    expect(isConvexArgumentValidationError("not-an-error")).toBe(false)
    expect(toInvalidDurableRequestError(convexShape)).toMatchObject({
      name: "PublicChatHttpError",
      statusCode: 400,
      code: "INVALID_REQUEST",
    })
    expect(toInvalidDurableRequestError(new Error("stream aborted"))).toBeNull()
  })
})

describe("excludeSystemRoleMessages", () => {
  it("drops system-role messages and reports the count", () => {
    const messages = [
      { id: "s", role: "system", parts: [{ type: "text", text: "legacy" }] },
      { id: "u", role: "user", parts: [{ type: "text", text: "hi" }] },
      { id: "a", role: "assistant", parts: [{ type: "text", text: "hello" }] },
    ] as unknown as UIMessage[]

    const result = excludeSystemRoleMessages(messages)
    expect(result.excludedCount).toBe(1)
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant"])
  })
})

describe("createErrorResponse", () => {
  it("echoes messages only for branded public errors", async () => {
    const response = createErrorResponse(
      new PublicChatHttpError({
        message: "No API key configured for OpenAI.",
        statusCode: 401,
        code: "MISSING_API_KEY",
      })
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "No API key configured for OpenAI.",
      code: "MISSING_API_KEY",
    })
  })

  it("redacts messages from errors without a statusCode (internal failures)", async () => {
    // A raw AI SDK TypeValidationError message embeds the entire offending
    // value — encrypted provider payloads included. It must never reach the
    // client.
    const response = createErrorResponse({
      message:
        'Type validation failed for messages[3].parts[2].output (web_search, id: "srvtoolu_x"): Value: [{"encryptedContent":"SECRET"}].',
    })
    expect(response.status).toBe(500)
    const body = (await response.json()) as { error: string; code: string }
    expect(body.code).toBe("INTERNAL_ERROR")
    expect(body.error).not.toContain("SECRET")
    expect(body.error).not.toContain("srvtoolu_")
    expect(body.error).toBe("An unexpected error occurred. Please try again.")
  })

  it("does not trust an arbitrary statusCode property", async () => {
    const response = createErrorResponse({
      message: "UNTRUSTED_PROVIDER_DETAIL_SENTINEL",
      statusCode: 400,
      code: "PROVIDER_ERROR",
    })
    expect(response.status).toBe(500)
    await expect(response.text()).resolves.not.toContain(
      "UNTRUSTED_PROVIDER_DETAIL_SENTINEL"
    )
  })
})
