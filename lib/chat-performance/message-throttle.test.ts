import { describe, expect, it } from "vitest"
import {
  RECOMMENDED_CHAT_MESSAGE_THROTTLE_MS,
  resolveChatMessageThrottleMs,
} from "./message-throttle"

describe("resolveChatMessageThrottleMs", () => {
  it("applies a configured interval", () => {
    expect(resolveChatMessageThrottleMs("32")).toBe(32)
    expect(resolveChatMessageThrottleMs("50")).toBe(50)
    expect(resolveChatMessageThrottleMs("100")).toBe(100)
  })

  it("disables on 0 and unset (the rollback path)", () => {
    expect(resolveChatMessageThrottleMs("0")).toBe(0)
    expect(resolveChatMessageThrottleMs(undefined)).toBe(0)
    expect(resolveChatMessageThrottleMs("")).toBe(0)
    expect(resolveChatMessageThrottleMs("  ")).toBe(0)
  })

  it("fails safe to disabled on malformed or out-of-range values", () => {
    expect(resolveChatMessageThrottleMs("fast")).toBe(0)
    expect(resolveChatMessageThrottleMs("-50")).toBe(0)
    expect(resolveChatMessageThrottleMs("Infinity")).toBe(0)
    expect(resolveChatMessageThrottleMs("NaN")).toBe(0)
    // A mistyped huge interval would delay approval/tool/terminal UI past the
    // plan's rollback bound — treat it as a config error, not a throttle.
    expect(resolveChatMessageThrottleMs("50000")).toBe(0)
  })

  it("floors fractional milliseconds", () => {
    expect(resolveChatMessageThrottleMs("32.9")).toBe(32)
  })

  it("keeps the recorded recommendation inside the accepted range", () => {
    expect(
      resolveChatMessageThrottleMs(String(RECOMMENDED_CHAT_MESSAGE_THROTTLE_MS))
    ).toBe(RECOMMENDED_CHAT_MESSAGE_THROTTLE_MS)
  })
})
