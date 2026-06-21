import { describe, expect, it } from "vitest"
import {
  getMessageBranchInfo,
  isNavigableBranch,
  parseMessageBranchInfo,
  readServerMessageId,
  resolveTurnBranch,
  type MessageBranchInfo,
} from "./branch"

describe("readServerMessageId", () => {
  it("reads a non-empty serverMessageId off a metadata record", () => {
    expect(readServerMessageId({ serverMessageId: "message_1" })).toBe(
      "message_1"
    )
  })

  it("rejects empty, non-string, missing, and non-record values", () => {
    expect(readServerMessageId({ serverMessageId: "" })).toBeUndefined()
    expect(
      readServerMessageId({ serverMessageId: 123 as unknown })
    ).toBeUndefined()
    expect(readServerMessageId({})).toBeUndefined()
    expect(readServerMessageId(undefined)).toBeUndefined()
    expect(readServerMessageId(null)).toBeUndefined()
    expect(
      readServerMessageId([{ serverMessageId: "x" }] as unknown)
    ).toBeUndefined()
  })
})

describe("parseMessageBranchInfo", () => {
  it("parses a well-formed branch descriptor", () => {
    expect(
      parseMessageBranchInfo({
        messageId: "m1",
        currentIndex: 1,
        total: 3,
        siblings: [
          { messageId: "m0" },
          { messageId: "m1", clientMessageId: "c1" },
          { messageId: "m2" },
        ],
      })
    ).toEqual({
      messageId: "m1",
      currentIndex: 1,
      total: 3,
      siblings: [
        { messageId: "m0" },
        { messageId: "m1", clientMessageId: "c1" },
        { messageId: "m2" },
      ],
    })
  })

  it("tolerates a partial sibling list (does not require length === total)", () => {
    const parsed = parseMessageBranchInfo({
      messageId: "m1",
      currentIndex: 0,
      total: 2,
      siblings: [{ messageId: "m1" }],
    })
    expect(parsed).toMatchObject({ total: 2, siblings: [{ messageId: "m1" }] })
  })

  it("drops malformed siblings but keeps valid ones", () => {
    const parsed = parseMessageBranchInfo({
      messageId: "m1",
      currentIndex: 0,
      total: 2,
      siblings: [{ messageId: "m1" }, { nope: true }, 42, null],
    })
    expect(parsed?.siblings).toEqual([{ messageId: "m1" }])
  })

  it("rejects when currentIndex is out of range", () => {
    expect(
      parseMessageBranchInfo({
        messageId: "m1",
        currentIndex: 2,
        total: 2,
        siblings: [],
      })
    ).toBeUndefined()
  })

  it("rejects non-branch values", () => {
    expect(parseMessageBranchInfo(undefined)).toBeUndefined()
    expect(parseMessageBranchInfo(null)).toBeUndefined()
    expect(parseMessageBranchInfo("branch")).toBeUndefined()
    expect(parseMessageBranchInfo([])).toBeUndefined()
    expect(
      parseMessageBranchInfo({ messageId: "m1", currentIndex: 0 })
    ).toBeUndefined()
  })
})

describe("getMessageBranchInfo", () => {
  it("reads the branch descriptor from message metadata", () => {
    expect(
      getMessageBranchInfo({
        metadata: {
          serverMessageId: "s1",
          branch: {
            messageId: "m1",
            currentIndex: 0,
            total: 2,
            siblings: [{ messageId: "m1" }, { messageId: "m2" }],
          },
        },
      })
    ).toMatchObject({ messageId: "m1", total: 2 })
  })

  it("returns undefined when there is no branch", () => {
    expect(getMessageBranchInfo(undefined)).toBeUndefined()
    expect(getMessageBranchInfo({ metadata: undefined })).toBeUndefined()
    expect(
      getMessageBranchInfo({ metadata: { serverMessageId: "s1" } })
    ).toBeUndefined()
  })
})

describe("isNavigableBranch", () => {
  it("is true only when there are at least two siblings", () => {
    expect(
      isNavigableBranch({
        messageId: "m1",
        currentIndex: 0,
        total: 2,
        siblings: [{ messageId: "m1" }, { messageId: "m2" }],
      })
    ).toBe(true)
    expect(
      isNavigableBranch({
        messageId: "m1",
        currentIndex: 0,
        total: 1,
        siblings: [{ messageId: "m1" }],
      })
    ).toBe(false)
    expect(isNavigableBranch(undefined)).toBe(false)
  })
})

describe("resolveTurnBranch", () => {
  const editBranch: MessageBranchInfo = {
    messageId: "u1",
    currentIndex: 1,
    total: 2,
    siblings: [{ messageId: "u1a" }, { messageId: "u1" }],
  }
  const regenBranch: MessageBranchInfo = {
    messageId: "a1",
    currentIndex: 0,
    total: 2,
    siblings: [{ messageId: "a1" }, { messageId: "a1b" }],
  }
  const user = (branch?: MessageBranchInfo) => ({
    role: "user",
    ...(branch ? { metadata: { branch } } : {}),
  })
  const assistant = (branch?: MessageBranchInfo) => ({
    role: "assistant",
    ...(branch ? { metadata: { branch } } : {}),
  })

  it("returns the user's own edit branch", () => {
    expect(resolveTurnBranch(user(editBranch), assistant())).toEqual(editBranch)
  })

  it("falls back to the response's regenerate branch when the prompt wasn't edited", () => {
    expect(resolveTurnBranch(user(), assistant(regenBranch))).toEqual(regenBranch)
  })

  it("prefers the edit branch when both exist", () => {
    expect(resolveTurnBranch(user(editBranch), assistant(regenBranch))).toEqual(
      editBranch
    )
  })

  it("returns undefined for an assistant message (never anchors there)", () => {
    expect(resolveTurnBranch(assistant(regenBranch), undefined)).toBeUndefined()
  })

  it("returns undefined for a user turn with nothing to navigate", () => {
    expect(resolveTurnBranch(user(), assistant())).toBeUndefined()
    expect(resolveTurnBranch(user(), undefined)).toBeUndefined()
  })

  it("ignores a regenerate branch when the next message is not an assistant", () => {
    expect(resolveTurnBranch(user(), user(regenBranch))).toBeUndefined()
  })

  it("does not treat a single-sibling branch as navigable", () => {
    const single: MessageBranchInfo = {
      messageId: "u1",
      currentIndex: 0,
      total: 1,
      siblings: [{ messageId: "u1" }],
    }
    expect(resolveTurnBranch(user(single), assistant(regenBranch))).toEqual(
      regenBranch
    )
  })
})
