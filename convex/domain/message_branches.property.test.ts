/**
 * PR 1 equivalence gate (chat-responsiveness plan): the canonical
 * single-pass `BranchContext` implementation must be byte-identical to the
 * pre-change implementation (verbatim legacy fixture) for EVERY context
 * operation — not only final selected ids — across the named fixture
 * classes, the deterministic 575/1,150-row trees, and 200 seeded randomized
 * trees covering cycles, duplicate/missing selection flags, explicit root
 * siblings, missing parent metadata, mixed roles, tied orders, and legacy
 * linear rows.
 */
import {
  buildDeterministicBranchTree,
  buildRandomBranchTree,
  buildRandomBranchTreeSeeds,
  hashValue,
  NAMED_BRANCH_FIXTURES,
  type BenchMessage,
} from "../../benchmarks/chat-performance/fixtures"
import { describe, expect, it } from "vitest"
import type { Id } from "../_generated/dataModel"
import * as candidate from "./message_branches"
import * as legacy from "./message_branches_legacy_fixture"

type BranchOps = {
  getSelectedPathMessages(messages: BenchMessage[]): BenchMessage[]
  getEffectiveParentId(
    messages: BenchMessage[],
    message: BenchMessage
  ): Id<"messages"> | undefined
  getSiblingMessages(
    messages: BenchMessage[],
    parentId: Id<"messages"> | undefined,
    role: BenchMessage["role"]
  ): BenchMessage[]
  getNextBranchIndex(
    messages: BenchMessage[],
    parentId: Id<"messages"> | undefined,
    role: BenchMessage["role"]
  ): number
  getNextMissingBranchIndex(
    messages: BenchMessage[],
    target: BenchMessage
  ): number
  getBranchInfoForMessage(
    messages: BenchMessage[],
    message: BenchMessage
  ): unknown
  getSelectedPathBranchNormalizationPatches(
    messages: BenchMessage[]
  ): unknown[]
  hasBranchState(messages: BenchMessage[]): boolean
}

/**
 * Exhaustive observable surface of one implementation over one tree: every
 * exported operation evaluated for every message and every (parent, role)
 * group, serialized for hashing.
 */
function fullSurface(ops: BranchOps, messages: BenchMessage[]) {
  const selectedPath = ops.getSelectedPathMessages(messages)
  const roles: Array<BenchMessage["role"]> = ["user", "assistant"]
  const parentIds = [
    undefined,
    ...messages.map((message) => message._id),
  ] as Array<Id<"messages"> | undefined>

  return {
    hasBranchState: ops.hasBranchState(messages),
    selectedPathIds: selectedPath.map((message) => String(message._id)),
    effectiveParents: messages.map((message) => [
      String(message._id),
      ops.getEffectiveParentId(messages, message) ?? null,
    ]),
    branchInfo: messages.map((message) => [
      String(message._id),
      ops.getBranchInfoForMessage(messages, message) ?? null,
    ]),
    nextMissingIndex: messages.map((message) => [
      String(message._id),
      ops.getNextMissingBranchIndex(messages, message),
    ]),
    siblingGroups: parentIds.flatMap((parentId) =>
      roles.map((role) => [
        `${parentId ?? "__root__"} ${role}`,
        ops
          .getSiblingMessages(messages, parentId, role)
          .map((message) => String(message._id)),
        ops.getNextBranchIndex(messages, parentId, role),
      ])
    ),
    normalizationPatches:
      ops.getSelectedPathBranchNormalizationPatches(messages),
  }
}

/** The candidate surface computed the single-pass way: ONE shared context. */
function singlePassSurface(messages: BenchMessage[]) {
  const context = candidate.createBranchContext(messages)
  const contextOps: BranchOps = {
    getSelectedPathMessages: () =>
      candidate.getSelectedPathMessagesFromContext(context),
    getEffectiveParentId: (_messages, message) =>
      candidate.getEffectiveParentIdFromContext(context, message),
    getSiblingMessages: (_messages, parentId, role) =>
      candidate.getSiblingMessagesFromContext(context, parentId, role),
    getNextBranchIndex: (_messages, parentId, role) =>
      candidate.getNextBranchIndexFromContext(context, parentId, role),
    getNextMissingBranchIndex: (_messages, target) =>
      candidate.getNextMissingBranchIndexFromContext(context, target),
    getBranchInfoForMessage: (_messages, message) =>
      candidate.getBranchInfoForMessageFromContext(context, message),
    getSelectedPathBranchNormalizationPatches: () =>
      candidate.getSelectedPathBranchNormalizationPatchesFromContext(context),
    hasBranchState: candidate.hasBranchState,
  }
  return fullSurface(contextOps, messages)
}

function expectEquivalent(messages: BenchMessage[], label: string) {
  const legacySurface = fullSurface(legacy as BranchOps, messages)
  const adapterSurface = fullSurface(candidate as BranchOps, messages)
  const sharedContextSurface = singlePassSurface(messages)

  const legacyHash = hashValue(legacySurface)
  // Two comparisons on purpose: the array adapters (flag-off call pattern)
  // and the shared-context path (flag-on) must BOTH match legacy exactly.
  if (hashValue(adapterSurface) !== legacyHash) {
    expect(adapterSurface, `${label}: adapter path`).toEqual(legacySurface)
  }
  if (hashValue(sharedContextSurface) !== legacyHash) {
    expect(sharedContextSurface, `${label}: shared context`).toEqual(
      legacySurface
    )
  }
}

describe("BranchContext equivalence vs pre-change implementation", () => {
  it("matches on every named fixture class", () => {
    for (const [name, build] of Object.entries(NAMED_BRANCH_FIXTURES)) {
      expectEquivalent(build(), name)
    }
  })

  it("matches on the deterministic 575-row and 1,150-row trees", () => {
    expectEquivalent(buildDeterministicBranchTree(575), "575-row tree")
    expectEquivalent(buildDeterministicBranchTree(1150), "1150-row tree")
  })

  it("matches on 200 seeded randomized trees", () => {
    for (const seed of buildRandomBranchTreeSeeds(200)) {
      expectEquivalent(buildRandomBranchTree(seed), `seed ${seed}`)
    }
  })

  it("keeps the context immutable at the type boundary and stable across reads", () => {
    const messages = buildDeterministicBranchTree(575)
    const context = candidate.createBranchContext(messages)
    const first = hashValue(
      candidate
        .getSelectedPathMessagesFromContext(context)
        .map((message) => message._id)
    )
    // Reading sibling groups and missing indexes must not mutate the context.
    for (const message of messages) {
      candidate.getBranchInfoForMessageFromContext(context, message)
      candidate.getNextMissingBranchIndexFromContext(context, message)
    }
    expect(
      hashValue(
        candidate
          .getSelectedPathMessagesFromContext(context)
          .map((message) => message._id)
      )
    ).toBe(first)
  })
})
