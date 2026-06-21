import type { MessageBranchInfo } from "@/lib/chat-messages/branch"
import { describe, expect, it } from "vitest"
import type { ChatTurnMessage } from "./chat-turn-service"
import {
  isSelectedPathDivergent,
  projectSelectedPath,
  reconcileSelectedPath,
} from "./selected-path"

function message(
  id: string,
  role: "user" | "assistant",
  text: string,
  metadata?: Record<string, unknown>
): ChatTurnMessage {
  return {
    id,
    role,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    parts: [{ type: "text", text }],
    ...(metadata ? { metadata } : {}),
  }
}

function serverMessage(
  serverMessageId: string,
  role: "user" | "assistant",
  text: string,
  branch?: MessageBranchInfo,
  id = serverMessageId
): ChatTurnMessage {
  return message(id, role, text, {
    serverMessageId,
    ...(branch ? { branch } : {}),
  })
}

describe("reconcileSelectedPath", () => {
  it("returns the same reference when nothing changes", () => {
    const live = [
      serverMessage("s1", "user", "hi"),
      serverMessage("s2", "assistant", "hello"),
    ]
    const server = [
      serverMessage("s1", "user", "hi"),
      serverMessage("s2", "assistant", "hello"),
    ]
    expect(reconcileSelectedPath(live, server)).toBe(live)
  })

  it("adopts server metadata onto identity-matched messages across the full path", () => {
    // Real durable chats already share ids (server persists clientMessageId =
    // client id); reconcile adopts serverMessageId/branch, including deep ones.
    const live = [
      message("u1", "user", "first"),
      message("a1", "assistant", "answer one"),
      message("u2", "user", "second"),
      message("a2", "assistant", "answer two"),
    ]
    const server = [
      serverMessage("s1", "user", "first", undefined, "u1"),
      serverMessage("s2", "assistant", "answer one", undefined, "a1"),
      serverMessage("s3", "user", "second", undefined, "u2"),
      serverMessage("s4", "assistant", "answer two", undefined, "a2"),
    ]
    const result = reconcileSelectedPath(live, server)
    expect(result.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"])
    // Deep message (index 0) reconciled, not just the tail.
    expect(result[0].metadata).toMatchObject({ serverMessageId: "s1" })
    expect(result[3].metadata).toMatchObject({ serverMessageId: "s4" })
  })

  it("does not mis-associate an optimistic send with a prior same-role message", () => {
    // The pre-send window: optimistic user added, server not updated yet. The
    // optimistic message must not adopt the earlier user's server identity.
    const live = [
      serverMessage("s1", "user", "first"),
      serverMessage("s2", "assistant", "answer"),
      message("opt-user", "user", "second (optimistic)"),
    ]
    const server = [
      serverMessage("s1", "user", "first"),
      serverMessage("s2", "assistant", "answer"),
    ]
    const result = reconcileSelectedPath(live, server)
    expect(result).toBe(live)
    expect(result[2].metadata).toBeUndefined()
  })

  it("adopts the branch descriptor + serverMessageId onto a matched message", () => {
    const branch: MessageBranchInfo = {
      messageId: "s2",
      currentIndex: 1,
      total: 2,
      siblings: [{ messageId: "s2a" }, { messageId: "s2" }],
    }
    const live = [message("s2", "assistant", "answer")]
    const server = [serverMessage("s2", "assistant", "answer", branch)]
    const result = reconcileSelectedPath(live, server)
    expect(result[0].metadata).toMatchObject({
      serverMessageId: "s2",
      branch,
    })
  })

  it("adopts the server's canonical createdAt onto a drifted streamed message", () => {
    const live = [
      {
        id: "a1",
        role: "assistant" as const,
        createdAt: new Date("2026-01-01T00:00:05.000Z"), // client stream time
        parts: [{ type: "text" as const, text: "answer" }],
      },
    ]
    const server = [
      {
        id: "a1",
        role: "assistant" as const,
        createdAt: new Date("2026-01-01T00:00:01.000Z"), // persisted time
        parts: [{ type: "text" as const, text: "answer" }],
        metadata: { serverMessageId: "a1" },
      },
    ]
    const result = reconcileSelectedPath(live, server)
    expect(result[0].createdAt).toEqual(new Date("2026-01-01T00:00:01.000Z"))
  })

  it("clears a stale branch descriptor when the server no longer has siblings", () => {
    const staleBranch: MessageBranchInfo = {
      messageId: "s2",
      currentIndex: 0,
      total: 2,
      siblings: [{ messageId: "s2" }, { messageId: "s2b" }],
    }
    const live = [
      message("s2", "assistant", "answer", {
        serverMessageId: "s2",
        branch: staleBranch,
      }),
    ]
    const server = [serverMessage("s2", "assistant", "answer")]
    const result = reconcileSelectedPath(live, server)
    expect(
      (result[0].metadata as Record<string, unknown>).branch
    ).toBeUndefined()
  })

  it("keeps trailing in-flight messages the server has not persisted yet", () => {
    const live = [
      serverMessage("s1", "user", "first"),
      serverMessage("s2", "assistant", "answer"),
      message("opt-u2", "user", "in flight"),
      message("opt-a2", "assistant", "streaming"),
    ]
    const server = [
      serverMessage("s1", "user", "first"),
      serverMessage("s2", "assistant", "answer"),
    ]
    const result = reconcileSelectedPath(live, server)
    expect(result.map((m) => m.id)).toEqual([
      "s1",
      "s2",
      "opt-u2",
      "opt-a2",
    ])
  })
})

describe("isSelectedPathDivergent", () => {
  it("is true when a rendered server-anchored message left the path", () => {
    const live = [
      serverMessage("s1", "user", "q"),
      serverMessage("s2-old", "assistant", "old answer"),
    ]
    const server = [
      serverMessage("s1", "user", "q"),
      serverMessage("s2-new", "assistant", "new answer"),
    ]
    expect(isSelectedPathDivergent(live, server)).toBe(true)
  })

  it("is true when the server path has a message the client stopped rendering", () => {
    // Branch-blind vanish: a rejected edit sliced the tail out of the live
    // array, but the server never created the branch — restore from server.
    const live = [
      serverMessage("s1", "user", "q"),
      serverMessage("s2", "assistant", "a"),
      message("opt-edit", "user", "edited q"),
    ]
    const server = [
      serverMessage("s1", "user", "q"),
      serverMessage("s2", "assistant", "a"),
      serverMessage("s3", "user", "original q2"),
      serverMessage("s4", "assistant", "original a2"),
    ]
    expect(isSelectedPathDivergent(live, server)).toBe(true)
  })

  it("is false during the persistence lag of a fresh send", () => {
    const live = [
      serverMessage("s1", "user", "q"),
      serverMessage("s2", "assistant", "a"),
      message("opt-u2", "user", "new question"),
      message("opt-a2", "assistant", "streamed"),
    ]
    const server = [
      serverMessage("s1", "user", "q"),
      serverMessage("s2", "assistant", "a"),
    ]
    expect(isSelectedPathDivergent(live, server)).toBe(false)
  })

  it("is false during normal convergence when the streamed id matches the server id", () => {
    // The streamed assistant carries the server id as its `id` but is not yet
    // metadata-anchored — it must not look "missing".
    const live = [
      serverMessage("s1", "user", "q"),
      message("s2", "assistant", "streamed answer"),
    ]
    const server = [
      serverMessage("s1", "user", "q"),
      serverMessage("s2", "assistant", "answer"),
    ]
    expect(isSelectedPathDivergent(live, server)).toBe(false)
  })
})

describe("projectSelectedPath", () => {
  it("returns live unchanged when there is no server path yet", () => {
    const live = [message("opt-u1", "user", "hi")]
    expect(projectSelectedPath(live, [])).toBe(live)
  })

  it("installs the server path when the live array is empty", () => {
    const server = [
      serverMessage("s1", "user", "q"),
      serverMessage("s2", "assistant", "a"),
    ]
    expect(projectSelectedPath([], server)).toBe(server)
  })

  it("swaps wholesale to the server path on a branch switch", () => {
    const live = [
      serverMessage("s1", "user", "q"),
      serverMessage("s2-old", "assistant", "old answer"),
    ]
    const server = [
      serverMessage("s1", "user", "q"),
      serverMessage("s2-new", "assistant", "new answer"),
    ]
    expect(projectSelectedPath(live, server)).toBe(server)
  })

  it("restores the server path when a rejected edit sliced messages out", () => {
    const live = [
      serverMessage("s1", "user", "q"),
      serverMessage("s2", "assistant", "a"),
      message("opt-edit", "user", "edited q"),
    ]
    const server = [
      serverMessage("s1", "user", "q"),
      serverMessage("s2", "assistant", "a"),
      serverMessage("s3", "user", "original q2"),
      serverMessage("s4", "assistant", "original a2"),
    ]
    expect(projectSelectedPath(live, server)).toBe(server)
  })

  it("reconciles (does not swap) when the path only gained identity", () => {
    const live = [
      message("opt-u1", "user", "q"),
      message("opt-a1", "assistant", "a"),
    ]
    // Server persisted these with clientMessageId === the optimistic ids, so
    // the rendered ids are stable and only `serverMessageId` is adopted.
    const server = [
      serverMessage("s1", "user", "q", undefined, "opt-u1"),
      serverMessage("s2", "assistant", "a", undefined, "opt-a1"),
    ]
    const result = projectSelectedPath(live, server)
    expect(result.map((m) => m.id)).toEqual(["opt-u1", "opt-a1"])
    expect(result[0].metadata).toMatchObject({ serverMessageId: "s1" })
    expect(result[1].metadata).toMatchObject({ serverMessageId: "s2" })
  })

  it("is idempotent — projecting a converged array is a no-op", () => {
    const live = [
      message("opt-u1", "user", "q"),
      message("opt-a1", "assistant", "a"),
    ]
    const server = [
      serverMessage("s1", "user", "q", undefined, "opt-u1"),
      serverMessage("s2", "assistant", "a", undefined, "opt-a1"),
    ]
    const once = projectSelectedPath(live, server)
    const twice = projectSelectedPath(once, server)
    expect(twice).toBe(once)
  })
})
