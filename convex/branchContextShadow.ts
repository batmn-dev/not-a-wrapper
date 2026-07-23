import { v } from "convex/values"
import { internalQuery } from "./_generated/server"
import {
  createBranchContext,
  getBranchInfoForMessage,
  getBranchInfoForMessageFromContext,
  getEffectiveParentId,
  getEffectiveParentIdFromContext,
  getSelectedPathBranchNormalizationPatches,
  getSelectedPathBranchNormalizationPatchesFromContext,
  getSelectedPathMessages,
  getSelectedPathMessagesFromContext,
} from "./domain/message_branches"

/**
 * PR 1 shadow comparison (chat-responsiveness plan, step 8): read-only
 * dual-compute of the branch projection through BOTH consumption patterns —
 * the per-call adapter path (flag off) and the shared single-pass context
 * (flag on) — over one chat, compared on a stable serialization of selected
 * ids, effective parents, branch indexes, selected flags, sibling order, and
 * descriptors.
 *
 * Deliberately an `internalQuery` operators invoke by hand
 * (`bunx convex run branchContextShadow:compareForChat '{"chatId": "..."}'`),
 * NEVER wired into the reactive `getSelectedConversation` path: a shadow
 * inside a reactive query would re-run on every invalidation and add CPU
 * exactly where PR 1 removes it. Returns counts and hashes only — no
 * content, no message bodies.
 */

function fnv1a(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0xcbf29ce4
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ ((code >> 8) ^ code), 0x01000193) >>> 0
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")
}

export const compareForChat = internalQuery({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
      .collect()

    // Per-call adapter pattern (the flag-off production shape).
    const perCallPath = getSelectedPathMessages(messages)
    const perCall = {
      selectedIds: perCallPath.map((message) => String(message._id)),
      effectiveParents: messages.map(
        (message) => getEffectiveParentId(messages, message) ?? null
      ),
      branchInfo: perCallPath.map(
        (message) => getBranchInfoForMessage(messages, message) ?? null
      ),
      branchFields: perCallPath.map((message) => [
        message.branchIndex ?? null,
        message.selected ?? null,
      ]),
      normalizationPatches: getSelectedPathBranchNormalizationPatches(messages),
    }

    // Shared single-pass context (the flag-on production shape).
    const context = createBranchContext(messages)
    const sharedPath = getSelectedPathMessagesFromContext(context)
    const shared = {
      selectedIds: sharedPath.map((message) => String(message._id)),
      effectiveParents: messages.map(
        (message) => getEffectiveParentIdFromContext(context, message) ?? null
      ),
      branchInfo: sharedPath.map(
        (message) =>
          getBranchInfoForMessageFromContext(context, message) ?? null
      ),
      branchFields: sharedPath.map((message) => [
        message.branchIndex ?? null,
        message.selected ?? null,
      ]),
      normalizationPatches:
        getSelectedPathBranchNormalizationPatchesFromContext(context),
    }

    const perCallHash = fnv1a(JSON.stringify(perCall))
    const sharedHash = fnv1a(JSON.stringify(shared))

    return {
      rowCount: messages.length,
      selectedCount: perCall.selectedIds.length,
      equal: perCallHash === sharedHash,
      perCallHash,
      sharedHash,
    }
  },
})
