# 1. Client renders the server-derived selected path; branch state is projected, not re-derived

- Status: accepted
- Date: 2026-06-20
- Context: C2 — branch-aware rendering (Increment 4), branch `darknight/iceberg-lounge`

## Context

The backend owns message identity, non-destructive sibling **message branches**,
and **selected path** derivation (`convex/domain/message_branches.ts`). The
`getSelectedPath` query returns the selected linear path plus its reconciliation
fingerprint, annotating each message with a transient `metadata.branch`
descriptor that lists its siblings by id. The client never receives the full
branch tree.

The AI SDK's `useChat` holds a single flat array with no concept of siblings,
and `sendMessage`/`regenerate` destructively truncate it
(`node_modules/ai/dist/index.mjs`). Before C2 the client reached branch state
through `metadata as Record<string, unknown>`, branch navigation blanked the
thread (the provider wiped optimistic state and waited for a Convex round-trip),
and reconciliation was a tail-2 id patch that could not fix edits made more than
two messages back.

The C2 brief recommended "re-deriving the selected path in the store from the
server messages (port/adapt `getSelectedPathMessages`)". Doing that faithfully
would require shipping the **entire branch tree** to the client, since
`getSelectedPathMessages` walks every sibling. That is a larger, higher-bandwidth
change with no product driver (the product wants `< n / m >` navigation, not a
visible tree).

## Decision

The client **trusts the server-derived selected path** and does **not** re-derive
it. Concretely:

1. **Branch state is first-class and typed.** A single client mirror of
   `MessageBranchInfo` lives in `lib/chat-messages/branch.ts`, with a tolerant
   parser. The durable adapter normalizes the transient `metadata.branch` into
   that type; renderers read it via `getMessageBranchInfo` /
   `getMessageBranch`, never via `metadata as Record<...>`. The message model's
   `metadata` stays `unknown` (to match the SDK's `UIMessage` for variance); the
   typing is applied at the leaf component props and the accessor.

2. **One projection seam owns the live array.** `projectSelectedPath`
   (`lib/chat-store/turns/selected-path.ts`) installs the reactive server
   selected path into the `useChat` array while the chat is idle
   (`use-chat-core.ts`). It adopts server ids + branch metadata onto matching
   live messages (full path, so deep edits reconcile), preserves trailing
   in-flight sends (the persistence lag), and **swaps wholesale** when the path
   diverged. Divergence covers both a branch switch (a rendered, anchored
   message left the path) and the "branch-blind vanish" (the server still has an
   anchored message the client stopped rendering after a rejected edit/regen);
   projecting on `error` as well as `ready` restores the last good path.

3. **Branch navigation never blanks.** `selectMessageBranch` only calls the
   `selectBranch` mutation; the reactive query + projection seam swap in the new
   path. The wipe-to-empty is gone.

## Consequences

- The client and server agree on the selected path because the server computes
  it and the client renders it — there is no second derivation to drift.
- The transient `metadata.branch` bridge remains, but it is now parsed into a
  typed value and is no longer the only channel: identity + branch state flow
  through the projection seam, which also reconciles ids and recovers from
  rejections.
- A live message becomes "anchored" (`metadata.serverMessageId`) only by adopting
  it from a server path. This is what makes the divergence discriminator sound:
  a streamed message (server id as `id`, not yet metadata-anchored) is matched by
  id and never looks "missing" during normal convergence.
- The legacy `reconcileRecentMessages(chatId, 2)` in `finishTurn` has been
  **removed** (2026-06-21 follow-up). The projection seam reconciles the full
  selected path by identity, and the tail-2 reconciler was in any case inert in
  the current cache architecture: server-persisted chats never populate the
  IndexedDB cache it read (`persistTurnMessage`/`finishTurn` gate caching on
  `!routePersists`), and guest chats cache the same client ids the live array
  already holds, so its id rewrite never fired. The only behavior it uniquely
  performed — rewriting a live message's top-level id to the server `_id` before
  the reactive round-trip — was not load-bearing (the server resolves by `_id`
  OR `clientMessageId`, and the selected-path token's tail anchor reads
  `metadata.serverMessageId`, which the projection adopts). Branch projection is
  now the sole owner of client identity adoption. Live-verified 2026-06-21 in a
  running durable chat: send, deep edit (>2 turns back), non-tail regeneration,
  and branch switch all render correctly with no message vanish/blank during the
  persistence-lag window — satisfying the original "once the projection is
  live-verified" gate.
- If the product later wants a visible branch tree, the full tree would need to
  reach the client; that is explicitly out of scope here.
