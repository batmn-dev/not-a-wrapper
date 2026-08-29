import {
  buildRandomBranchTree,
  buildRandomBranchTreeSeeds,
  makeBenchMessage,
} from "../../benchmarks/chat-performance/fixtures"
import { describe, expect, it } from "vitest"
import {
  createBranchContext,
  getBranchInfoForMessageFromContext,
  getEffectiveParentIdFromContext,
  getSelectedPathBranchNormalizationPatchesFromContext,
  getSelectedPathMessagesFromContext,
} from "./message_branches"

describe("Message branch invariants", () => {
  it("keeps a legacy linear chat reachable and describes its normalization", () => {
    const messages = [
      makeBenchMessage("user_0", 0, "user"),
      makeBenchMessage("assistant_0", 1, "assistant"),
      makeBenchMessage("user_1", 2, "user"),
    ]
    const before = structuredClone(messages)
    const context = createBranchContext(messages)

    expect(context.hasBranchState).toBe(false)
    expect(
      getSelectedPathMessagesFromContext(context).map((message) => message._id)
    ).toEqual(["user_0", "assistant_0", "user_1"])
    expect(
      getSelectedPathBranchNormalizationPatchesFromContext(context)
    ).toEqual([
      { messageId: "user_0", branchIndex: 0, selected: true },
      {
        messageId: "assistant_0",
        parentMessageId: "user_0",
        branchIndex: 0,
        selected: true,
      },
      {
        messageId: "user_1",
        parentMessageId: "assistant_0",
        branchIndex: 0,
        selected: true,
      },
    ])
    expect(messages).toEqual(before)
  })

  it("keeps legacy history reachable after branching", () => {
    const legacyUser = makeBenchMessage("user_0", 0, "user")
    const legacyAnswer = makeBenchMessage("assistant_0", 1, "assistant")
    const legacyFollowUp = makeBenchMessage("user_1", 2, "user")
    const oldAnswer = makeBenchMessage("assistant_1", 3, "assistant", {
      parentMessageId: legacyFollowUp._id,
      branchIndex: 0,
      selected: false,
    })
    const newAnswer = makeBenchMessage("assistant_2", 4, "assistant", {
      parentMessageId: legacyFollowUp._id,
      branchIndex: 1,
      selected: true,
    })

    const context = createBranchContext([
      legacyUser,
      legacyAnswer,
      legacyFollowUp,
      oldAnswer,
      newAnswer,
    ])

    expect(
      getSelectedPathMessagesFromContext(context).map((message) => message._id)
    ).toEqual([
      legacyUser._id,
      legacyAnswer._id,
      legacyFollowUp._id,
      newAnswer._id,
    ])
  })

  it("reports sibling order from branch indexes", () => {
    const root = makeBenchMessage("user_0", 0, "user", {
      branchIndex: 0,
      selected: true,
    })
    const later = makeBenchMessage("assistant_2", 1, "assistant", {
      parentMessageId: root._id,
      branchIndex: 2,
      selected: false,
    })
    const selected = makeBenchMessage("assistant_0", 2, "assistant", {
      parentMessageId: root._id,
      branchIndex: 0,
      selected: true,
    })
    const context = createBranchContext([later, selected, root])

    expect(
      getSelectedPathMessagesFromContext(context).map((message) => message._id)
    ).toEqual([root._id, selected._id])
    expect(getBranchInfoForMessageFromContext(context, later)).toEqual({
      messageId: later._id,
      currentIndex: 1,
      total: 2,
      siblings: [
        { messageId: selected._id, clientMessageId: undefined },
        { messageId: later._id, clientMessageId: undefined },
      ],
    })
  })

  it("preserves path, metadata, and normalization invariants on malformed trees", () => {
    for (const seed of buildRandomBranchTreeSeeds(80)) {
      const messages = buildRandomBranchTree(seed)
      const before = structuredClone(messages)
      const context = createBranchContext(messages)
      const selectedPath = getSelectedPathMessagesFromContext(context)
      const selectedIds = selectedPath.map((message) => message._id)

      expect(new Set(selectedIds).size, `seed ${seed}: path cycle`).toBe(
        selectedIds.length
      )
      for (let index = 1; index < selectedPath.length; index++) {
        expect(
          getEffectiveParentIdFromContext(context, selectedPath[index]!),
          `seed ${seed}: disconnected path`
        ).toBe(selectedPath[index - 1]!._id)
      }

      for (const message of messages) {
        const info = getBranchInfoForMessageFromContext(context, message)
        if (!info) continue
        expect(info.total).toBe(info.siblings.length)
        expect(info.siblings[info.currentIndex]?.messageId).toBe(message._id)
      }

      const pathIds = new Set(selectedIds)
      const patches =
        getSelectedPathBranchNormalizationPatchesFromContext(context)
      expect(new Set(patches.map((patch) => patch.messageId)).size).toBe(
        patches.length
      )
      for (const patch of patches) {
        expect(pathIds.has(patch.messageId)).toBe(true)
        const source = messages.find(
          (message) => message._id === patch.messageId
        )!
        if (patch.parentMessageId !== undefined) {
          expect(source.parentMessageId).toBeUndefined()
        }
        if (patch.branchIndex !== undefined) {
          expect(source.branchIndex).toBeUndefined()
        }
        if (patch.selected !== undefined) {
          expect(source.selected).toBeUndefined()
        }
      }

      expect(
        getSelectedPathMessagesFromContext(context).map(
          (message) => message._id
        )
      ).toEqual(selectedIds)
      expect(messages).toEqual(before)
    }
  })
})
