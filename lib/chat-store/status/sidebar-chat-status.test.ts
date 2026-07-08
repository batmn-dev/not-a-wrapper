import { describe, expect, it } from "vitest"
import { deriveChatRowStatus } from "./sidebar-chat-status"

describe("deriveChatRowStatus", () => {
  it("maps the chat doc's live_run_status through when there is no override", () => {
    expect(deriveChatRowStatus({ live_run_status: "streaming" }, null)).toBe(
      "streaming"
    )
    expect(deriveChatRowStatus({ live_run_status: "awaiting" }, null)).toBe(
      "awaiting"
    )
  })

  it("returns idle for a chat with no projection fields (guest/local/optimistic)", () => {
    expect(deriveChatRowStatus({}, null)).toBe("idle")
  })

  it("lets a non-idle override win over the backend (local error beats projected streaming)", () => {
    // Terminal failure writes are best-effort and can lag, so the tab that
    // errored is authoritative for its own row.
    expect(deriveChatRowStatus({ live_run_status: "streaming" }, "error")).toBe(
      "error"
    )
  })

  it("does not let an idle override lower the backend (re-entered background run keeps spinning)", () => {
    // Nav remounts Chat without resuming the stream, so the active tab reads
    // `ready` → idle override; the projected spinner must survive.
    expect(deriveChatRowStatus({ live_run_status: "streaming" }, "idle")).toBe(
      "streaming"
    )
  })
})
