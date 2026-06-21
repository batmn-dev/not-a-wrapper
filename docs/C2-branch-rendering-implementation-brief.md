# C2 Implementation Brief — Branch-Aware Rendering (Increment 4) & Mid-Conversation Regeneration (Increment 5)

**Audience:** senior engineer picking up the Chat-turn branch work.
**Stack:** Next.js (App Router) · AI SDK v6 (`ai@6.0.78`, `@ai-sdk/react@3.0.80`) · Convex · WorkOS auth.
**Branch:** `darknight/iceberg-lounge`. Prior phase (C1) landed in commit `bdd4c06`.

---

## 0. TL;DR of the mission

The backend **already owns** message identity, non-destructive sibling branches, and selected-path derivation. The client does **not** render them well: sibling info reaches the UI only through a fragile transient bridge, branch navigation blanks the chat, and regeneration is limited to the last message. Your job is to make the **client a faithful renderer of the backend's selected path**, with first-class branch state, and to enable **regenerating/editing any message** in the conversation — not just the tail.

This is "C2" in the architecture review. It builds directly on "C1" (already shipped): edit and regenerate are now **server-owned, durable-only Chat turns**; the destructive client-side truncation *persistence* and the local edit/regen transaction machinery were deleted. C1 did **not** yet replace the optimistic client-side truncation rendering, nor make the store branch-aware — that's this work.

---

## 1. The single architectural principle that governs everything

> **`useChat`'s message array can only ever hold the selected *linear* path. The branch tree and selected-path derivation must live in our store and be projected into `useChat` via `setMessages`.**

This is not a preference — it's forced by the AI SDK. We verified against the installed source (`node_modules/ai/dist/index.mjs`):

- `useChat` state is a **single flat array with no concept of siblings**.
- `sendMessage({ messageId })` does `this.state.messages = this.state.messages.slice(0, messageIndex + 1)` (index.mjs:12447) — destructive linear truncation, in the SDK core.
- `regenerate({ messageId })` does `slice(0, role === "assistant" ? messageIndex : messageIndex + 1)` (index.mjs:12480) — drops the target **and everything after it**, then streams one new message onto the stump, with **no way to re-attach the rest of the selected path**.
- The SDK **does adopt the server's message id** from the stream `start` chunk: `state.message.id = chunk.messageId` (index.mjs:5417). Our route already mints it via `toUIMessageStreamResponse({ generateMessageId })` (`app/api/chat/route.ts:1541-1543`). So the *streamed assistant message* gets server identity for free — but only that one message.

**Consequences you must design around:**
1. You cannot get branch rendering from `useChat` alone. Own the tree in the store; `setMessages` the selected linear path.
2. For **last-message** turns (send, regenerate-last, edit-resubmit-last), the SDK's truncation is harmless (nothing after to lose) — keep using `useChat` directly.
3. For **mid-conversation** turns, do **not** route through `useChat.regenerate({messageId})`. Use a Convex "prepare-branch" mutation that returns the new selected path, `setMessages` it, then stream the new tail. (See Increment 5.)

LibreChat (a mature reference we studied; local repo at `/Users/andresgonzalez/Github/Projects/libreChat`) does exactly this shape: server rebuilds the prefix from DB ancestry, client keeps a full tree and selects the path by `parentMessageId` + `siblingIdx`, and **never** does destructive truncation. See their load-bearing comment at `client/src/hooks/Chat/useChatFunctions.ts:153-160` (they hit and fixed the `slice(0, targetIndex)` bug). Do not copy their full tree renderer; adapt the principle.

---

## 2. What is already true (do not rebuild these)

### Backend — complete and tested
- **Schema** (`convex/schema.ts`): `messages` table has `parentMessageId`, `branchIndex`, `selected` (optional), plus index `by_chat_parent` (`["chatId", "parentMessageId"]`).
- **Selected-path derivation**: `convex/domain/message_branches.ts`
  - `getSelectedPathMessages(messages)` (≈148) — walks parent → selected child to a leaf, returns the linear path.
  - `getBranchInfoForMessage(allMessages, message)` (≈242) — returns `MessageBranchInfo | undefined`.
  - Type (≈12): `MessageBranchInfo = { messageId, currentIndex, total, siblings: { messageId, clientMessageId? }[] }`.
  - Also: `hasBranchState`, `getEffectiveParentId`, `getSiblingMessages`, `getNextBranchIndex`, `getSelectedPathBranchNormalizationPatches`.
- **Branch writes**: `convex/domain/message_branch_writes.ts` — `selectMessageSiblingForMutation`, `getNextBranchIndexForMutation`, `normalizeSelectedBranchPathForMutation`.
- **Query surface** (`convex/messages.ts`):
  - `getVisibleSelectedMessages(messages)` (≈60) = `withBranchMetadata(getSelectedPathMessages(...))`.
  - `withBranchMetadata` (≈35) attaches a **transient** `metadata.branch: MessageBranchInfo` to each selected message (recomputed per query; never persisted).
  - Queries `getForChat` / `getPublicForChat` / `getLastMessages` all go through `getVisibleSelectedMessages`.
  - `selectBranch` mutation (≈179) → `selectBranchForChat(...)` (≈143): args `{ chatId, messageId }`; flips `selected` so a chosen sibling becomes the rendered path.
- **Generation intents** (`convex/chatRuntime.ts`):
  - `applyEditIntentForGeneration` (≈699-786) — creates a **new user-message sibling** under the edited message's parent (non-destructive), marks it selected.
  - `applyRegenerationIntentForGeneration` (≈574-697) — creates a **new assistant sibling** under the same parent, marks it selected. Throws `"Regeneration target version changed"` at ≈611 when `expectedChatVersion` no longer matches (optimistic-concurrency guard — **this is correct and must keep working**).
  - `prepareGenerationForChat` (≈1098-1280) — rebuilds the model prefix from the persisted selected path; does **not** trust a client array.
  - `findMessageByUiId` (≈208-226) — resolves a message by **either** `_id` **or** `clientMessageId`.
- **Stream id minting**: `app/api/chat/route.ts:1541-1549` — `result.toUIMessageStreamResponse({ originalMessages, generateMessageId, consumeSseStream, messageMetadata })`. `generateMessageId` is set for durable runs.

### Client — C1 already shipped (commit `bdd4c06`)
- Edit/regenerate are **durable-only**, enforced in `app/components/chat/chat-turn.ts` (`isRouteDurableChat(chatId, isAuthenticated)` precondition; edit returns typed `not-durable`, regenerate toasts + returns) and gated in the UI via a threaded `isDurableChat` prop (`chat.tsx` → `conversation.tsx` → `message.tsx` → `message-user.tsx`/`message-assistant.tsx`).
- The local edit/regen transaction machinery (`prepareEditPersistence`'s local branch, `activeLocalEdit`, `activeLocalRegeneration`, `stageRegeneration`, `rollback*`, `finishActiveLocalRegeneration`) is **deleted** from `lib/chat-store/turns/chat-turn-service.ts`.
- `runEditTurn` (`chat-turn.ts`) now always sends the `edit` intent and still does an **optimistic** `setMessages([...trimmed, optimisticEdit])` → `setMessages(trimmed)` → filter optimisticEdit → `stagePendingEdit`. **This optimistic truncation render is what Increment 4 should replace with selected-path projection.**
- `finishTurn` still calls `reconcileRecentMessages(chatId, 2)` (the tail-2 id reconcile) — a stopgap you will largely retire (the SDK already adopts the streamed assistant id; the store should reconcile the whole selected path instead).

### Domain language (use these exact terms — see `CONTEXT.md`)
- **Chat turn** — one user action that changes a conversation; edit/regenerate are server-owned, durable-only, may target any prior message; guest/local chats are send-only.
- **Message branch** — a sibling message alternative under the same parent.
- **Selected path** — the backend-derived linear path used for rendering and model history; hidden siblings stay stored but unsent.

---

## 3. The client gap you are closing

1. **`ExtendedUIMessage` has no branch fields.** `parentMessageId` / `branchIndex` / `selected` never reach the client model. Sibling info exists only as transient `metadata.branch` attached server-side (`convex/messages.ts:withBranchMetadata`) and read in `app/components/chat/message-branch-controls.tsx` via `getMessageBranch(metadata)`.
2. **The bridge is fragile.** `metadata.branch` is `v.any()`-typed, recomputed on every query, and **lost on optimistic update** (the store strips/replaces messages). Branch controls only render when `total >= 2` **and** `siblings.length === total`, so any partial/optimistic state hides them.
3. **Branch navigation blanks the chat.** `lib/chat-store/messages/provider.tsx:selectMessageBranch` (≈331) calls the `selectBranch` mutation then `updateOptimisticMessages(() => [])` — it **wipes** optimistic state and waits for the Convex query to round-trip, producing a visible flash/blank.
4. **Two message layers, easy to get wrong.** The provider composes `serverMessages` (Convex reactive, carry `metadata.branch`) + `optimisticMessages`, exposes them as `messages`, and feeds them as `initialMessages` to `useChat`. The provider's own `setMessages` (≈350) keeps only non-server ids in the optimistic layer. Understand this composition before changing projection.
5. **Regeneration is last-message-only on the client.** `prepareRegenerationTurnPlan` (`lib/chat-store/turns/chat-turn-service.ts`) rejects non-tail targets with `unsupported-target` (≈312-317), even though the backend supports regenerating any assistant message.

---

## 4. Increment 4 — Branch-aware selected-path rendering

**Goal:** the client renders the backend-derived selected path with first-class, typed branch state; branch navigation is instant (no blank); optimistic updates never lose branch info. After this, the `useChat` array is always exactly the selected linear path, reconciled to server identity from the stream + the store (not the tail-2 hack).

### 4.1 Make branch state first-class in the client model
- Extend `ExtendedUIMessage` (and `durableStoredMessageToUiMessage` in `lib/chat-messages/ui-message-adapter.ts`, which already sets `metadata.serverMessageId = message._id`) so each message carries a **typed** branch descriptor derived from `MessageBranchInfo` — not reached for via `metadata as Record<string, unknown>`.
- Define the client-side branch type once (mirror `convex/domain/message_branches.ts:MessageBranchInfo`) and have `message-branch-controls.tsx` consume the typed field instead of `getMessageBranch(metadata)`. Keep a tolerant guard for messages that have no branch (most don't).
- Decide the source of truth for the selected path on the client: prefer **re-deriving** it in the store from the server messages (port/adapt `getSelectedPathMessages` so the client and server agree) rather than depending solely on the server's per-query `metadata.branch`. The transient bridge can remain as a fast path, but it must not be the *only* channel.

### 4.2 Project the selected path into `useChat` via a single seam
- Centralize "install the server-derived selected path into the live turn array" behind one helper used by: initial hydration, post-edit, post-regen, and branch switch. `setMessages` (exposed from `useChat` in `app/components/chat/use-chat-core.ts:231,358`) is the projection seam.
- Replace the **optimistic truncation render** in `runEditTurn` (`chat-turn.ts`) with: optimistic frame → on stream events/finish, project the server selected path. The optimistic frame stays as a *visual affordance only* (per the strategic direction); the rendered truth is the backend selected path.
- Retire `reconcileRecentMessages(chatId, 2)` in favor of full selected-path reconciliation: the SDK adopts the streamed assistant id (§1); the store reconciles the rest of the path (optimistic ids → server ids) using `serverMessageId`/`clientMessageId` already present in metadata. Confirm no edit deeper than 2 messages is left with a stale optimistic id (this was a known limitation).

### 4.3 Branch navigation without blanking
- Rewrite `selectMessageBranch` (`provider.tsx:331`) so it does **not** `updateOptimisticMessages(() => [])`. Optimistically switch the rendered selected path to the chosen sibling (you have the sibling ids in `MessageBranchInfo.siblings`), call the `selectBranch` mutation, and let the Convex reactive update confirm — reconciling rather than wiping. The `< n / m >` control (`message-branch-controls.tsx`) should update instantly.
- Make the branch controls render reliably across optimistic/streaming states (the current `total >= 2 && siblings.length === total` gate is too brittle once branch state is first-class).

### 4.4 Fix the two bugs surfaced in C1 live testing
Both are exactly in this increment's path:
- **Edit stale-status rejection.** `app/components/chat/use-chat-edit.ts` (via `use-chat-core.ts`) captures a stale `status`/`isSubmitting` in the `submitEdit` closure, so edits are sometimes wrongly refused with *"Please wait until the current message finishes sending."* while the chat is idle (clears on re-render/reload). Read `status`/`isSubmitting` from a ref or re-derive at call time so the generation-active guard uses live values.
- **Branch-blind vanish.** When a regenerate/edit request is rejected server-side (e.g. the `expectedChatVersion` guard fires), the SDK has already sliced the assistant message out and does not restore it → the message vanishes until reload. With the store now owning the selected path (§4.2), a rejection should re-project the last good selected path instead of leaving a hole. (Increment 5's prepare-branch flow avoids this for mid-conversation; this covers the last-message path too.)

### 4.5 Increment 4 — definition of done
- `ExtendedUIMessage` carries typed branch state; `message-branch-controls.tsx` reads it without `metadata as Record<...>`.
- Switching branches is instant (no blank/flash); verified live on a chat with ≥2 siblings.
- Editing a message ≥3 turns back reconciles to the correct server id (no stale optimistic id).
- The two bugs above no longer reproduce.
- `useChat`'s array equals the backend selected path after every turn.
- Unit tests for: client selected-path derivation, branch-state projection, branch-switch reconciliation, the generation-active guard reading live status.

---

## 5. Increment 5 — Mid-conversation regeneration (+ prepare-branch mutation)

**Goal:** regenerate (and, ideally, edit-resubmit) **any** message, not just the last. The backend already supports this; the work is a client seam that doesn't fight the AI SDK's linear truncation.

### 5.1 Lift the last-message restriction
- Remove the `unsupported-target` gate in `prepareRegenerationTurnPlan` (`lib/chat-store/turns/chat-turn-service.ts:≈312-317`) so a non-tail assistant message is a valid target. Keep the other validity checks (role, preceding user, timestamp).

### 5.2 Prepare-branch seam (the settled design)
The seam decision from the C2 grilling: **unified `/api/chat` for last-message turns; a Convex "prepare-branch" mutation for mid-conversation branch ops.** Rationale (from §1): `useChat.regenerate({messageId})` truncates the tail and can't re-attach the selected path; a pre-mutation hands you the authoritative new path synchronously, you `setMessages` it, then stream the new tail — never fighting the SDK.

Implement:
- A Convex mutation (compose the existing `applyRegenerationIntentForGeneration` / branch-write helpers; reuse the `expectedChatVersion` guard) that **creates the sibling and returns the new selected path** (server ids + branch info) **without** starting generation.
- Client flow for a mid-conversation regen: call the mutation → `setMessages(newSelectedPath)` (server ids already canonical, so the SDK has nothing to truncate) → start a normal generation request for the new tail. The streamed assistant message adopts its server id via the `start` chunk (§1).
- For **last-message** regen/edit, keep the current unified `/api/chat` path (no pre-mutation needed) — it already works and is live-verified.

### 5.3 Server selected-path stream event (optional but recommended)
LibreChat emits the authoritative ids + selected path as the first stream event (their `created` handler). Mirror this for the unified path: have the route emit the new selected path as a **transient data part** at stream start, and consume it via `useChat`'s `onData` (wired in `use-chat-core.ts`) to project via the §4.2 seam. This lets even last-message turns reconcile the path in one round trip and removes any residual need for `reconcileRecentMessages`. (`onData` for transient data parts is handled at `node_modules/ai/dist/index.mjs:5466`.)

### 5.4 Increment 5 — definition of done
- Regenerating a mid-conversation assistant message produces a new sibling, updates the selected path, and the old branch becomes navigable via `< n / m >` — no blank, no vanished messages.
- Editing a mid-conversation user message (if in scope) behaves the same.
- The `expectedChatVersion` guard still rejects stale/duplicate requests, and the client re-projects the last good path on rejection (no hole).
- Unit tests for the prepare-branch mutation (sibling created, selected path returned, version guard) and the client mid-conversation flow.

---

## 6. Code reference map

| Concern | File / symbol |
|---|---|
| Selected-path derivation, branch info type | `convex/domain/message_branches.ts` — `getSelectedPathMessages`, `getBranchInfoForMessage`, `MessageBranchInfo` |
| Branch writes | `convex/domain/message_branch_writes.ts` |
| Query surface + transient `metadata.branch` | `convex/messages.ts` — `getVisibleSelectedMessages`, `withBranchMetadata`, `selectBranch`/`selectBranchForChat` |
| Edit/regen intents + version guard + prefix rebuild | `convex/chatRuntime.ts` — `applyEditIntentForGeneration`, `applyRegenerationIntentForGeneration` (guard ≈611), `prepareGenerationForChat`, `findMessageByUiId` |
| Schema (branch fields, index) | `convex/schema.ts` — `messages` (`parentMessageId`, `branchIndex`, `selected`, `by_chat_parent`) |
| Stream id minting | `app/api/chat/route.ts:1541-1549` — `toUIMessageStreamResponse({ generateMessageId, ... })` |
| Client store (two layers, setMessages, selectMessageBranch) | `lib/chat-store/messages/provider.tsx` (≈331 selectMessageBranch, ≈350 setMessages) |
| IndexedDB cache | `lib/chat-store/messages/api.ts` |
| Stored→UI adapter (metadata.serverMessageId, branch) | `lib/chat-messages/ui-message-adapter.ts` — `durableStoredMessageToUiMessage` |
| Turn controller | `app/components/chat/chat-turn.ts` — `runEditTurn`, `runRegenerationTurn`, `finishChatTurn` |
| Turn store (reconcile, finishTurn) | `lib/chat-store/turns/chat-turn-service.ts` — `prepareRegenerationTurnPlan` (≈312 gate), `reconcileRecentMessages`, `finishTurn`, `buildSelectedPathToken` |
| useChat wiring (setMessages, onFinish, onData) | `app/components/chat/use-chat-core.ts` (≈231 setMessages, ≈238 onFinish) |
| Edit hook (stale-status bug) | `app/components/chat/use-chat-edit.ts` |
| Branch controls UI | `app/components/chat/message-branch-controls.tsx` — `MessageBranchInfo`/`getMessageBranch`, `MessageBranchControls` |
| Conversation / message routing | `app/components/chat/conversation.tsx`, `message.tsx`, `message-assistant.tsx`, `message-user.tsx` |
| AI SDK internals (read-only reference) | `node_modules/ai/dist/index.mjs` — 5417 (id adoption), 5466 (onData transient), 5497-5510 (server id reuse), 12447/12480 (truncation) |
| LibreChat reference (do not copy wholesale) | `/Users/andresgonzalez/Github/Projects/libreChat` — `useChatFunctions.ts:153-160`, `MultiMessage.tsx`, `utils/messages.ts:selectActiveBranchTail` |

---

## 7. Testing & verification

- **Unit:** `bunx vitest run` (full suite was 748 tests / 86 files green at C1). Add tests beside the changed modules (`*.test.ts(x)`). Existing turn-service / turn-controller tests are the model for harness style.
- **Typecheck:** `bunx tsc --noEmit`. **Lint:** `bunx eslint .`.
- **Live (required for the rendering/streaming work):** the app runs via `bun run dev` (Next + Convex via `concurrently`); auth (WorkOS) is bound to `http://localhost:3000`, so do **not** re-port it. Durable behavior needs an **authenticated** session. In this project we drove the real browser with the Claude-in-Chrome MCP (it shares the logged-in session) — the Preview MCP's fresh headless browser is a guest and can't reach durable chats without logging in.
- **Live scenarios to verify:** (a) switch between ≥2 siblings — instant, no blank; (b) edit a message 3+ turns back — correct reconciliation; (c) regenerate a mid-conversation assistant — new sibling, navigable old branch; (d) trigger the version guard (rapid double action) — clean rejection, no vanished message.
- **Package manager:** `bun` (per repo + user preference). Use `bunx`/`bun add`.

---

## 8. Risks, sequencing, and guardrails

- **Do Increment 4 before 5.** 5's mid-conversation flow depends on the store owning the selected path and projecting via `setMessages` (4). Don't start 5 until branch switch + reconciliation are solid.
- **Two message layers.** The provider merges `serverMessages` (Convex reactive) + optimistic; `useChat` is initialized from that. Trace this composition before changing projection, or you'll get duplicate/disappearing messages.
- **Keep the server version guard.** `expectedChatVersion` rejecting stale requests is correct behavior; handle it on the client (re-project), don't weaken it.
- **Don't introduce a full tree renderer.** Product direction: selected-path rendering with `< n/m >` navigation, not a LibreChat-style visible tree, unless product asks.
- **No ADRs exist** (`docs/adr/` absent). If you make a load-bearing decision (e.g. client re-derives selected path vs. trusts server metadata), record it — start the `docs/adr/` directory.
- **Update `CONTEXT.md`** if you name a new concept (e.g. "prepare-branch", "branch projection") — keep the domain glossary in sync, same discipline as the existing entries.
- **Commit per increment**, each with the full suite green + a live check. C1's commit (`bdd4c06`) is the model for scope/message.

---

## 9. Why this matters (the through-line)

The architecture review's top recommendation was to collapse the dual edit/resend model into one server-owned Chat turn (C1 — done) and then make the client a renderer of server-owned ancestry (C2 — this brief). The backend is the deep module here; the client has been carrying a second, contradictory history model. Increments 4–5 finish the job: server owns identity and the selected path; the client renders it and navigates branches; the AI SDK holds only the selected linear slice. That removes the destructive-truncation class of bugs for good and unlocks branch-compatible Chat turns end-to-end.
