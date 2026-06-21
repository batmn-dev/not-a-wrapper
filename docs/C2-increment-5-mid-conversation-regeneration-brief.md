# C2 Implementation Brief — Increment 5: Mid-Conversation Regeneration

**Audience:** senior engineer continuing the Chat-turn branch work after Increment 4.
**Stack:** Next.js (App Router) · AI SDK v6 (`ai@6.0.78`, `@ai-sdk/react@3.0.80`) · Convex · WorkOS auth.
**Branch:** `darknight/iceberg-lounge`. Increment 4 landed in commit `02f1ceb` (on top of C1 `bdd4c06`).
**Companion docs:** `docs/C2-branch-rendering-implementation-brief.md` (the original C2 brief — read §1 and §5), `docs/adr/0001-client-renders-server-selected-path.md`, `CONTEXT.md` (domain glossary).

---

## 0. TL;DR of the mission

Let a user **regenerate any assistant message, not just the last one**. The backend's branch model already supports non-tail siblings; two explicit "tail only" gates (one client, one server) currently block it, and the client turn flow was never wired for a non-tail target.

The headline insight: **Increment 4 already built the machinery this needs.** The selected-path projection seam reconciles the live `useChat` array to the backend selected path on every idle settle, and its wholesale-swap path already renders arbitrary mid-conversation branch selections (verified live: deep edits fork correctly and restore their subtree). So Increment 5 is much smaller than the original brief assumed — most likely **lift the two gates and let the existing `useChat.regenerate` + projection do the work**, with the heavyweight "prepare-branch mutation" reserved as a fallback only if live testing shows a real problem.

**Also important:** mid-conversation **edit** is already done. Increment 4 delivered it — `applyEditIntentForGeneration` has no tail restriction, and editing a message 3 turns back was verified live (it forks: a new prompt sibling + fresh response, old downstream becomes a navigable sibling). So Increment 5 is **only about regeneration.** The original brief's "edit a mid-conversation user message (if in scope)" line is already satisfied; confirm with a test, don't rebuild.

---

## 1. What Increment 4 delivered that you will build on

Read the ADR (`docs/adr/0001-client-renders-server-selected-path.md`) first. The load-bearing pieces:

- **Selected-path projection seam** — `lib/chat-store/turns/selected-path.ts`:
  - `projectSelectedPath(live, serverPath)` — installs the reactive server selected path into the `useChat` array. Pure, exhaustively unit-tested (`selected-path.test.ts`).
  - `reconcileSelectedPath` — adopts server **id / createdAt / branch metadata** onto live messages by **identity** (id ↔ `serverMessageId` cross-keys), never positional. Preserves trailing in-flight sends. Idempotent (returns the same `live` ref when converged).
  - `isSelectedPathDivergent` — decides "reconcile vs swap wholesale." Two directions: `removed` (a rendered, server-anchored message left the path → a sibling was selected) and `missing` (the server path has an anchored message the client stopped rendering → restore a sliced-out turn). Both mean "trust the server path."
- **The idle projection effect** — `app/components/chat/use-chat-core.ts` (the hydrate+project `useEffect`, currently ~lines 461–500). Runs only when `status === "ready" || status === "error"` (never mid-stream); routes through `setMessagesRef.current` (NOT the raw `setMessages` dep) to avoid an infinite render loop; deps are `[chatId, initialMessages, status]`. Tested at the hook level in `use-chat-core.test.tsx` ("selected-path projection" describe).
- **Branch nav anchored on the user message** — `resolveTurnBranch` (`lib/chat-messages/branch.ts`) + `conversation.tsx`. Edit branches render on the prompt; regenerate branches render on the prompt's **response** but are surfaced **on the user message** (the descriptor carries the assistant sibling ids, so `onSelectBranch(assistantSiblingId)` still works). Assistant messages render no control.
- **Branch switch without blanking** — `provider.tsx:selectMessageBranch` no longer wipes optimistic state; it calls the `selectBranch` mutation and lets the reactive query + projection swap the path.

These mean: **once a mid-conversation regen creates a server-side sibling and flips selection, the client already knows how to render the new path and make the old branch navigable.** You are mostly removing blockers, not building rendering.

---

## 2. The two gates to lift (and the one the original brief missed)

### 2.1 Client gate — `prepareRegenerationTurnPlan`

`lib/chat-store/turns/chat-turn-service.ts` (~289–349). It computes the regeneration plan and **rejects any non-tail target**:

```ts
if (
  targetIndex !== lastAssistantIndex ||
  targetIndex !== visibleMessages.length - 1
) {
  return { ok: false, reason: "unsupported-target" }   // ~line 316
}
```

Remove this block. **Keep every other check** — `message-not-found`, `invalid-target-role` (must be assistant), `missing-message-timestamp`, and the preceding-user lookup / `missing-preceding-user`. The plan's `retainedMessages = visibleMessages.slice(0, precedingUserIndex + 1)` and the regeneration intent (`targetAssistantMessageId`, `targetAssistantCreatedAt`, `expectedChatVersion`, `precedingUserMessageId`) are already correct for any position.

Also delete the `"unsupported-target"` member from the `RegenerationTurnPlan` failure union (~line 273) and update `runRegenerationTurn` in `app/components/chat/chat-turn.ts` (~454–516), which currently treats every non-`message-not-found` failure as a silent `reportError`.

### 2.2 Server gate — `applyRegenerationIntentForGeneration` (the one the original brief did NOT call out)

`convex/chatRuntime.ts` (~574–697). After the version guards it throws on any non-tail target:

```ts
if (
  targetIndex !== lastAssistantIndex ||
  targetIndex !== selectedMessages.length - 1
) {
  throw new Error("Only the latest assistant message can be regenerated")   // ~lines 620–625
}
```

Remove this block. **Keep the guards above it** (they are correct and must keep working):
- `selectedMessages.length !== args.regeneration.expectedChatVersion` → `"Chat changed since regeneration started"` (~593).
- `targetMessage.createdAt !== args.regeneration.targetAssistantCreatedAt` → `"Regeneration target version changed"` (~608–610).

Everything below the gate already generalizes to any position: it resolves the parent via `getEffectiveParentId(currentMessages, targetMessage)` (the preceding user message for a mid-conversation target), clears sibling selection, inserts a new `selected: true` assistant sibling, and returns the model prefix as `selectedMessages.slice(0, pairedUserIndex + 1).filter(isModelHistoryMessage)` — correct for a target anywhere in the path.

> ⚠️ If you lift only the client gate (as the original brief's §5.1 implies), the request will reach the server and be rejected here with a 500. Lift **both**.

---

## 3. The recommended approach — and why it's simpler than the original brief

### 3.1 Why `useChat.regenerate({messageId})` is now FINE for mid-conversation

The original brief (§1, §5.2) argued you must NOT route mid-conversation regen through `useChat.regenerate({messageId})` because the SDK does `slice(0, messageIndex)` and "can't re-attach the selected path," and prescribed a synchronous **prepare-branch mutation** instead. That reasoning predates Increment 4. Re-examine it:

- For an assistant target at index `i`, the SDK truncates the live array to `[0 … i-1]` = everything up to and including the **preceding user message**, then streams one new assistant onto the stump. The resulting live array is `[…prefix, precedingUser, newAssistant]`.
- The server (after you lift its gate) creates a new assistant **sibling** under `precedingUser`, marks it selected, and the old target + its downstream become a **deselected** sibling branch. The new server selected path is `[…prefix, precedingUser, newAssistant]`.
- **These are the same shape.** A mid-conversation regen is a *fork* — you do not want to re-attach the old downstream (it was a response to the *old* assistant; keeping it would be incoherent). This matches ChatGPT, which truncates the visible thread to that point and exposes the old continuation via the branch nav. So the SDK's "destructive" truncation is exactly the correct render for a fork.
- The streamed assistant adopts the server message id via `generateMessageId` (`app/api/chat/route.ts:~1543`), so on settle (`status: "ready"`) the idle projection sees `live === serverPath` (by identity) and converges with no swap. The old downstream is absent from both live and the selected path (it's a hidden sibling) — no "vanish" bug, and it's reachable via the new assistant's `< n/m >` (rendered on the preceding user message per `resolveTurnBranch`).

**Recommended primary plan (Option B): lift both gates, keep the existing `runRegenerationTurn` → `useChat.regenerate({messageId, body})` path, and let the Increment-4 projection reconcile.** Validate live (see §5). This is a handful of lines plus tests.

### 3.2 The fallback — prepare-branch mutation (Option A, the original brief's §5.2)

If live testing surfaces a real problem with Option B (e.g. a jarring flash, or the version guard misbehaving in a way you can't fix at the guard), fall back to the original brief's design:

- A Convex **mutation** that composes `applyRegenerationIntentForGeneration` / the branch-write helpers (`convex/domain/message_branch_writes.ts`) and the `expectedChatVersion` guard to **create the sibling and return the new selected path (server ids + branch info) WITHOUT starting generation**.
- Client flow: call the mutation → `setMessages(newSelectedPath)` (server ids are canonical, so the SDK has nothing to truncate) → start a normal generation request for the new tail. The streamed assistant adopts its server id via the `start` chunk.

This is heavier (a new mutation + a parallel client seam + its own reconciliation). **Do not build it preemptively.** Increment 4 was explicitly designed to make Option B viable; prove Option B fails before reaching for Option A.

### 3.3 Optional — server selected-path stream event (original brief §5.3)

Still optional, still recommended only if you find a residual reconciliation gap: emit the new selected path as a transient data part at stream `start` and consume it via `useChat`'s `onData`, projecting through the §1 seam. With identity-based reconcile + `generateMessageId` already adopting the server id, you likely won't need it.

---

## 4. Insights & gotchas carried over from Increment 4 (read before you touch the turn flow)

These are hard-won from live testing Increment 4. They will save you hours.

1. **The infinite-render-loop trap.** The idle projection effect must NOT depend on the raw `setMessages` from `useChat` (it is not referentially stable → effect runs every render → project→set→render loop). Route through `setMessagesRef.current` and keep deps `[chatId, initialMessages, status]`. There are regression tests for this; don't regress them. If you add any new effect that calls `setMessages`, follow the same pattern.

2. **`createdAt` drift breaks the version guard.** The server's regen guard compares `targetMessage.createdAt !== targetAssistantCreatedAt` exactly. A freshly-streamed assistant's client-side `createdAt` can differ from the persisted value. Increment 4 fixed this by having `reconcileSelectedPath` adopt the server's canonical `createdAt`. **Mid-conversation regen is even more sensitive to this** (the target may have been touched by prior in-session branch ops). Verify in-session (not just after reload) that regenerating a mid-conversation message is not falsely rejected with `"Regeneration target version changed"`. If it is, the projection isn't adopting `createdAt` for that message before the regen fires — chase that, don't weaken the guard.

3. **The `expectedChatVersion` count-drift edge (known, unfixed — likely in scope for you).** After a rapid multi-branch session, the client's `sanitizeVisibleChatMessages(messages).length` can drift from the server's selected-path count, falsely tripping `"Chat changed since …"`. It clears on reload (a fresh load makes client count == server count). It's benign (clean rejection, no vanish) but **mid-conversation regen leans hard on `expectedChatVersion`**, so this is the most likely thing to bite you. See the memory note `c2-edit-version-guard-count-drift.md` and `docs/adr/0001`. The right fix direction: when idle and not in a send's persistence lag, the live array should equal the server selected path exactly — the projection currently preserves trailing un-anchored messages, which is correct during a send but can leave a stale extra after complex branch ops. Consider tightening that, with care not to drop a legitimately-just-sent turn.

4. **`isSelectedPathDivergent` handles rejection recovery.** Projection runs on `status === "error"` too. If a mid-conversation regen is rejected server-side (version guard), the SDK has already truncated the live array, but the server never created the sibling, so the server path still has the old downstream → projection's `missing` branch swaps it back in (no vanish). This is why you keep the `"error"` case in the projection effect. Add a live test for "trigger the guard on a mid-conversation target → clean toast, nothing vanishes."

5. **Branch-nav placement is product-decided and already wired.** Branch nav lives **on the user message** (`resolveTurnBranch`): a regenerate sibling shows on the *preceding user* message, not the assistant. A mid-conversation regen therefore makes the `< n/m >` appear on that turn's user bubble. Don't add a control to the assistant; `message-assistant.tsx` intentionally renders none.

6. **The both-axes limitation (known).** A single `< n/m >` on the user message can't express two branch dimensions. If a turn is **both** edited and its response regenerated, `resolveTurnBranch` shows the *edit* branch and the regen siblings become UI-unreachable (data is safe server-side, just not navigable). Mid-conversation regen makes this combination more reachable. If product wants both reachable, the fix is two controls on the user message (prompt-nav + response-nav) — flag it; it's out of scope unless asked.

7. **Live verification is mandatory and needs an authenticated browser.** WorkOS auth is bound to `http://localhost:3000`; durable chats need a logged-in session. Drive the real browser (the Claude-in-Chrome MCP shares the logged-in session); the headless Preview MCP is a guest and can't reach durable chats. Unit tests passed at 100% while a real infinite loop shipped in Increment 4 — **the loop, the createdAt drift, and the layout mismatch were all caught only by live testing.** Budget for it.

---

## 5. Testing & verification

- **Unit:** `bunx vitest run` (790 green after Increment 4). Add tests beside the changed modules. Specifically:
  - `chat-turn-service.test.ts`: `prepareRegenerationTurnPlan` now accepts a non-tail assistant target (returns `ok: true` with the correct `retainedMessages` and `precedingUserMessageId`); still rejects invalid role / missing preceding user / missing timestamp.
  - Convex domain test for the lifted server gate: regenerating a mid-conversation assistant creates a `selected` sibling under the correct parent, returns the prefix `slice(0, pairedUserIndex + 1)`, and the `expectedChatVersion` / `targetAssistantCreatedAt` guards still reject stale requests.
  - Keep the lean-test discipline (the user pushes back on test bloat — see memory `prefers-lean-test-suites`): concentrate on the gate lift, the version-guard behavior, and the plan shape. Don't re-test the projection (already covered).
- **Typecheck / lint:** `bunx tsc --noEmit`, `bunx eslint .`.
- **Live (required), against an authenticated durable chat with ≥3 turns (e.g. apples → oranges → bananas):**
  1. Regenerate the **middle** assistant (oranges): a new sibling streams, the thread truncates to that turn, the old continuation (bananas) becomes navigable via `< n/m >` on the oranges **user** message, no blank, console clean.
  2. Switch back to the original sibling: the full original downstream (bananas) is restored (this already works via projection — confirm it still does through a regen-created branch).
  3. **In-session** (no reload) regenerate a mid-conversation message immediately after other branch ops: confirm it is **not** falsely rejected by the version guard (createdAt + count drift, §4.2/§4.3).
  4. Trigger the guard deliberately (rapid double-action on a mid-conversation target): clean toast, **nothing vanishes** (projection-on-error restores).
  5. Watch the dev "Issues" badge and `read_console_messages` for `Maximum update depth exceeded` after every action — that's the loop tripwire.

---

## 6. Code reference map

| Concern | File / symbol |
|---|---|
| Client regen plan + the gate to remove | `lib/chat-store/turns/chat-turn-service.ts` — `prepareRegenerationTurnPlan` (~289–349; gate ~312–317; union member ~273) |
| Client regen turn flow | `app/components/chat/chat-turn.ts` — `runRegenerationTurn` (~454–516); `handleReload` in `app/components/chat/use-chat-core.ts` (~577–590) |
| Server regen intent + the gate to remove + guards to keep | `convex/chatRuntime.ts` — `applyRegenerationIntentForGeneration` (~574–697; gate ~620–625; guards ~593 and ~608–610) |
| Server generation dispatch (regen vs edit vs send) | `convex/chatRuntime.ts` — `prepareGenerationForChat` (~1098–1280; regen branch ~1192–1208) |
| Mid-conversation EDIT (already works — model for "fork") | `convex/chatRuntime.ts` — `applyEditIntentForGeneration` (~699–786; no tail restriction) |
| Branch writes (compose for Option A if needed) | `convex/domain/message_branch_writes.ts`; `convex/domain/message_branches.ts` (`getEffectiveParentId`, `getNextBranchIndex`, `getBranchInfoForMessage`) |
| Selected-path projection seam (the Increment-4 groundwork) | `lib/chat-store/turns/selected-path.ts` — `projectSelectedPath`, `reconcileSelectedPath`, `isSelectedPathDivergent` |
| Idle projection effect (loop-safe pattern) | `app/components/chat/use-chat-core.ts` — hydrate+project `useEffect` (~461–500) |
| Branch nav placement | `lib/chat-messages/branch.ts` — `resolveTurnBranch`; `app/components/chat/conversation.tsx` |
| Stream id minting (assistant adopts server id) | `app/api/chat/route.ts` (~1541–1549, `toUIMessageStreamResponse({ generateMessageId, … })`) |
| Decision record | `docs/adr/0001-client-renders-server-selected-path.md` |
| Known edges (memory) | `c2-edit-version-guard-count-drift.md`, `prefers-lean-test-suites` |
| AI SDK internals (read-only) | `node_modules/ai/dist/index.mjs` — 12447/12480 (truncation), 5417 (id adoption), 5466 (onData transient) |

---

## 7. Definition of done

- Regenerating a **mid-conversation** assistant message produces a new selected sibling, forks the thread at that turn, and the prior continuation is navigable via `< n/m >` on that turn's **user** message — no blank, no vanished messages.
- Both gates are lifted (client `unsupported-target` **and** server `"Only the latest assistant message can be regenerated"`); all other validity checks and both optimistic-concurrency guards still reject stale/duplicate requests cleanly.
- A guard rejection on a mid-conversation target leaves the conversation intact (projection-on-error restores the last good path).
- In-session mid-conversation regen is not falsely rejected (createdAt + count-drift addressed or proven non-triggering).
- Mid-conversation **edit** confirmed still working (a test pinning it is enough; it already ships).
- Unit tests for the lifted client plan and the lifted server intent (sibling created under the correct parent, prefix correct, guards intact). Lean — no projection re-tests.
- `bunx tsc --noEmit`, `bunx vitest run`, `bunx eslint .` all green.
- Live-verified against an authenticated durable chat (the five scenarios in §5).
- Commit per the Increment-4 model (`02f1ceb`): one focused commit, full suite green, live check done. If you lift the server gate, note in `CONTEXT.md` / the ADR that regeneration is no longer tail-restricted (the "Chat turn" glossary entry already says edit/regenerate "may target any prior message" — make the code match the doc, and remove any now-stale "last assistant only" wording).

---

## 8. The one-paragraph version for your future self

The backend already creates non-destructive siblings anywhere; mid-conversation **edit** already ships; Increment 4 built a projection seam that renders any selected path and recovers from rejections. So mid-conversation **regeneration** is: delete two "tail only" gates (client `prepareRegenerationTurnPlan` ~316, server `applyRegenerationIntentForGeneration` ~620), keep all the other checks and both version guards, and let `useChat.regenerate({messageId})` + the idle projection do the fork — because the SDK's truncation produces exactly the forked selected path the server computes. Verify live (the loop, createdAt drift, and count-drift are the three things that will bite). Only build the prepare-branch mutation if Option B demonstrably fails. Watch the console for `Maximum update depth exceeded` after every click.
