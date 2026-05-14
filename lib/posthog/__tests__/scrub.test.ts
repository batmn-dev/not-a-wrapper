import { describe, expect, it } from "vitest"
import { scrubForAnalytics } from "../scrub"

const R = "[REDACTED]"

describe("scrubForAnalytics", () => {
  it("redacts known sensitive keys (case-insensitive)", () => {
    const input = {
      email: "alice@example.com",
      Phone: "+1-555-123-4567",
      cardId: "card_abc123",
      shippingAddress: { line1: "123 Main St" },
    }
    const result = scrubForAnalytics(input)

    expect(result.email).toBe(R)
    // key matching is lowercase — "Phone" should still match
    expect(result.Phone).toBe(R)
    expect(result.cardId).toBe(R)
    expect(result.shippingAddress).toBe(R)
  })

  it("redacts payment method details", () => {
    const input = { paymentMethod: { type: "card" } }
    const result = scrubForAnalytics(input)
    expect(result.paymentMethod).toBe(R)
  })

  it("redacts email patterns in free text", () => {
    const input = "Contact us at support@vendor.com for help"
    const result = scrubForAnalytics(input)
    expect(result).toBe(`Contact us at ${R} for help`)
    expect(result).not.toContain("support@vendor.com")
  })

  it("redacts phone patterns in free text", () => {
    const input = "Call me at (415) 555-1234 or +1-800-555-9999"
    const result = scrubForAnalytics(input)
    expect(result).not.toContain("555-1234")
    expect(result).not.toContain("555-9999")
  })

  it("preserves non-sensitive structure", () => {
    const input = {
      role: "user",
      content: "hello world",
      model: "gpt-4",
      count: 42,
      active: true,
    }
    const result = scrubForAnalytics(input)
    expect(result).toEqual(input)
  })

  it("handles nested objects and arrays", () => {
    const input = {
      messages: [
        { role: "user", parts: [{ type: "text", text: "Email me at a@b.com" }] },
        { role: "assistant", parts: [{ type: "text", text: "Sure" }] },
      ],
      meta: { nested: { email: "x@y.com" } },
    }
    const result = scrubForAnalytics(input)
    expect(result.messages[0].parts[0].text).toBe(`Email me at ${R}`)
    expect(result.messages[1].parts[0].text).toBe("Sure")
    expect(result.meta.nested.email).toBe(R)
  })

  it("handles null, undefined, and primitives", () => {
    expect(scrubForAnalytics(null)).toBeNull()
    expect(scrubForAnalytics(undefined)).toBeUndefined()
    expect(scrubForAnalytics(42)).toBe(42)
    expect(scrubForAnalytics(true)).toBe(true)
  })

  it("caps recursion depth to avoid stack overflow", () => {
    let deeply: Record<string, unknown> = { value: "safe" }
    for (let i = 0; i < 25; i++) {
      deeply = { nested: deeply }
    }
    const result = scrubForAnalytics(deeply)
    expect(result).toBeDefined()
  })

  it("handles credentials, password, secret, token keys", () => {
    const input = {
      credentials: { apiKey: "sk-123" },
      password: "hunter2",
      secret: "s3cret",
      token: "tok_abc",
    }
    const result = scrubForAnalytics(input)
    expect(result.credentials).toBe(R)
    expect(result.password).toBe(R)
    expect(result.secret).toBe(R)
    expect(result.token).toBe(R)
  })

  it("does not redact safe field names", () => {
    const input = {
      chatId: "chat_123",
      model: "claude-4",
      provider: "anthropic",
      content: "Hello",
    }
    expect(scrubForAnalytics(input)).toEqual(input)
  })
})
