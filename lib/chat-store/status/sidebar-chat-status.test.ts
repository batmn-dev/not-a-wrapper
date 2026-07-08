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

  it("derives unread when a completed run finished after the read cursor", () => {
    expect(
      deriveChatRowStatus(
        { last_run_ended_at: 200, last_run_status: "completed", last_read_at: 100 },
        null
      )
    ).toBe("unread")
  })

  it("derives error when a failed run finished after the read cursor", () => {
    expect(
      deriveChatRowStatus(
        { last_run_ended_at: 200, last_run_status: "failed", last_read_at: 100 },
        null
      )
    ).toBe("error")
  })

  it("derives idle once the read cursor has caught up (seen)", () => {
    expect(
      deriveChatRowStatus(
        { last_run_ended_at: 200, last_run_status: "completed", last_read_at: 200 },
        null
      )
    ).toBe("idle")
  })

  it("derives idle for an aborted run (no mirror written)", () => {
    // aborted/superseded only clear liveRunStatus; no lastRunEndedAt/Status →
    // never a dot.
    expect(deriveChatRowStatus({ last_read_at: 100 }, null)).toBe("idle")
  })

  it("lets live status beat an unseen completion", () => {
    // A new turn started (live streaming) after a prior unseen completion: the
    // live phase wins over the stale unread mirror.
    expect(
      deriveChatRowStatus(
        {
          live_run_status: "streaming",
          last_run_ended_at: 200,
          last_run_status: "completed",
          last_read_at: 100,
        },
        null
      )
    ).toBe("streaming")
  })
})
