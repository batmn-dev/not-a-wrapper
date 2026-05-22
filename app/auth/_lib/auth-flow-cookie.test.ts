import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createEmailVerificationFlow,
  openAuthFlowCookieValue,
  sealAuthFlowCookieValue,
} from "./auth-flow-cookie"

vi.mock("server-only", () => ({}))

describe("auth flow cookie sealing", () => {
  beforeEach(() => {
    process.env.WORKOS_COOKIE_PASSWORD = "a".repeat(32)
  })

  it("round-trips an email verification flow without exposing plaintext", () => {
    const flow = createEmailVerificationFlow(
      "person@example.com",
      "pending_token_123",
      1_700_000_000_000
    )

    const sealed = sealAuthFlowCookieValue(flow)

    expect(sealed).not.toContain("person@example.com")
    expect(sealed).not.toContain("pending_token_123")
    expect(openAuthFlowCookieValue(sealed, 1_700_000_000_001)).toEqual(flow)
  })

  it("rejects expired flow values", () => {
    const flow = createEmailVerificationFlow(
      "person@example.com",
      "pending_token_123",
      1_700_000_000_000
    )

    const sealed = sealAuthFlowCookieValue(flow)

    expect(openAuthFlowCookieValue(sealed, flow.expiresAt + 1)).toBeNull()
  })

  it("rejects tampered values", () => {
    const sealed = sealAuthFlowCookieValue(
      createEmailVerificationFlow(
        "person@example.com",
        "pending_token_123",
        1_700_000_000_000
      )
    )

    expect(openAuthFlowCookieValue(`${sealed}a`, 1_700_000_000_001)).toBeNull()
  })

  it("rejects values sealed with another cookie password", () => {
    const sealed = sealAuthFlowCookieValue(
      createEmailVerificationFlow(
        "person@example.com",
        "pending_token_123",
        1_700_000_000_000
      )
    )

    process.env.WORKOS_COOKIE_PASSWORD = "b".repeat(32)

    expect(openAuthFlowCookieValue(sealed, 1_700_000_000_001)).toBeNull()
  })
})
