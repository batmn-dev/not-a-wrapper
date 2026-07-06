import { describe, expect, it } from "vitest"
import { parseChatTurnRequest } from "./chat-turn-contract"

const validBody = {
  messages: [
    { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] },
  ],
  chatId: "chat-1",
  model: "test-model",
  systemPrompt: "system",
}

describe("parseChatTurnRequest", () => {
  it("accepts a valid turn request and returns it typed", () => {
    const result = parseChatTurnRequest(
      { ...validBody, userId: "guest_abc", chatVersion: 3 },
      { isAuthenticated: false }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.chatId).toBe("chat-1")
    expect(result.request.model).toBe("test-model")
    expect(result.request.chatVersion).toBe(3)
  })

  it("rejects missing required fields with per-field details", () => {
    expect(
      parseChatTurnRequest(
        { messages: validBody.messages },
        { isAuthenticated: true }
      )
    ).toEqual({
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      error: "Missing required fields",
      details: { messages: "ok", chatId: "required", model: "required" },
    })
    // A non-object body degrades to the same missing-fields rejection.
    const nonObject = parseChatTurnRequest("nope", { isAuthenticated: true })
    expect(nonObject).toMatchObject({ ok: false, status: 400 })
  })

  it("rejects a turn carrying both edit and regeneration", () => {
    const result = parseChatTurnRequest(
      { ...validBody, edit: {}, regeneration: {} },
      { isAuthenticated: true }
    )
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      error: "Regeneration cannot be combined with edit generation",
      // Flagged unexpected — a client-contract violation the route captures to
      // Sentry, unlike routine bad input which stays silent.
      unexpected: true,
    })
    // Routine bad input is NOT flagged unexpected.
    const missingFields = parseChatTurnRequest(
      { messages: validBody.messages },
      { isAuthenticated: true }
    )
    expect(missingFields).not.toHaveProperty("unexpected")
  })

  it("requires a guest id only for unauthenticated turns", () => {
    expect(parseChatTurnRequest(validBody, { isAuthenticated: false })).toEqual(
      {
        ok: false,
        status: 400,
        code: "MISSING_GUEST_ID",
        error: "Guest ID required for anonymous users",
      }
    )
    expect(
      parseChatTurnRequest(validBody, { isAuthenticated: true })
    ).toMatchObject({ ok: true })
  })
})
