# 12. Atomic first-turn creation: the first-turn path can never strand a chat without its first user message

- Status: accepted
- Date: 2026-07-18
- Related: ADR-0006 (Chat turn runtime — intact), ADR-0009/0011 (Durable turn
  runtime/settlement — intact; the generation run still starts via
  `POST /api/chat`), ADR-0010 (HTTP trust boundary — intact)

## Context

First-turn chat creation was non-atomic. `ensureChatExists`
(`app/components/chat/use-chat-operations.ts`) created the durable chat row
through `chats.create` and handed off the route (shallow `pushState`) BEFORE
attachment binding (`files.attachStagedFiles`) and message dispatch ran in the
Chat turn controller (`runSendTurn`). Three failure modes stranded a
permanently empty chat on a live route:

1. attachment binding failed or returned an incomplete set after the chat was
   created;
2. the tab closed (or the network died) between creation and the
   `POST /api/chat` that persists the user message at durable-prepare;
3. any dispatch throw after creation, when the same-mount allocation ref could
   not be reused (e.g. the surface was reloaded).

Rate-limit and prompt-size refusals were already safe — they run before
creation. A same-mount retry recovers via the allocation ref; refresh or
abandonment does not.

## Decision

### 1. One transaction server-side: `chats.createWithFirstTurn`

A new authenticated Convex mutation (`convex/chats.ts`,
`createChatWithFirstTurnForUser`) that, in one mutation — therefore one Convex
transaction — performs:

1. project ownership check (`requireOwnedProject`) when `projectId` is given;
2. the chat insert (same row shape as `chats.create`);
3. binding of the COMPLETE staged-attachment set through the shared
   validate-all-before-any-patch core (`files.bindStagedAttachmentsToChat`,
   extracted from `attachStagedFiles`, which now delegates to it);
4. the initial user message write through the **Message branch writer**
   (`writeUserMessage`), with parts built server-side from the just-validated
   bindings (never from client-supplied URLs);
5. the project activity bump.

Any throw rolls back everything including the chat row (Convex mutation
transactionality — a platform guarantee, not something this repo's fakes can
exercise): THIS path can no longer strand a chat without its first user
message. That is a path invariant, not a schema invariant — see Compatibility
below. The mutation returns `{ chatId, userMessageId, attachments }`.

### 2. The generation still starts via `POST /api/chat` (ADR-0009/0011 intact)

The atomic mutation creates no generation run. The client dispatches the same
wire-contract body afterwards, and `prepareGeneration`'s idempotent
`writeUserMessage` finds the pre-persisted row by `clientMessageId` (the
turn's optimistic id, threaded into the atomic creation) and SELECTS it
instead of inserting a duplicate.

Two seam adjustments make that claim exact:

- **Provenance-optional user-message writes.** The branch writer's
  `WriteUserMessageInput` provenance stamp (`requestId`/`model`/`provider`)
  is now optional: the first-turn write predates any generation request and
  carries none. The FIRST claiming run adopts its stamp onto the un-stamped
  row (idempotent-select path); later repeats never restamp. Assistant
  placeholders keep the required stamp — only a generation writes them.
- **The first-turn selected-path token states the server fact.** After atomic
  creation the server's visible selected path is exactly one message, so the
  controller sends `{ expectedVisibleMessageCount: 1, tailMessageId:
  userMessageId }` instead of deriving the token from its still-empty
  rendered array (which would falsely reject the turn as stale). The wire
  contract is unchanged — these are existing fields.

### 3. Client first-turn path

- `ChatsProvider.createNewChat` is replaced by `createFirstTurnChat`
  (`lib/chat-store/chats/provider.tsx`): the guest/local branch, the
  Convex-auth readiness gate, and the optimistic sidebar ops are unchanged;
  the durable branch calls the atomic mutation. A guest-shaped creation
  carrying staged attachments fails closed (staging requires auth).
- `ensureChatExists` returns `EnsuredTurnChat` — `{ chatId }` for an existing
  or local chat, plus `firstTurn: { userMessageId, attachments }` when this
  call atomically created a durable chat. Navigation now happens only AFTER
  the full commit.
- `runSendTurn` validates the staged set and allocates the optimistic id
  BEFORE creation (an unbindable reference must reject before any chat
  exists), skips its own `attachStagedFiles` call on the first-turn branch,
  and overrides the token as above. The edit runner drops its
  `ensureChatExists` call entirely — its durable-chat guard already proves
  the chat exists, so edits never allocate.

### Compatibility

`chats.create` is retained for rolling-deploy compatibility (clients running
pre-atomic bundles) but is no longer the app's first-turn path. While it
remains deployed, old bundles and direct API callers can still create bare
chat rows — so "no chat without its first message" holds for the app's
first-turn path, not globally. Both mutations construct the chat row through
one shared core (`insertChatForUser`), so a future chat field or default
cannot silently diverge between them.

## Alternatives rejected

- **Compensating deletion of zero-message chats** (a sweep or
  unload-triggered delete): weaker on every axis — empty chats remain visible
  until swept; the sweep must distinguish "abandoned" from "legitimately slow
  first turn" by inference, and deleting durable rows on inference is exactly
  the bug class the Generation run lifecycle's terminal-stub rules exist to
  prevent; and it adds a second writer racing turn dispatch.
- **Persisting the user message inside `POST /api/chat` chat creation**: the
  route is the HTTP adapter (ADR-0006); moving creation there would put chat
  allocation behind the streaming request and break the route-first handoff
  the client surfaces depend on.

## Consequences

- The remaining failure window is honest: if the `POST` never arrives (tab
  closed right after commit), the chat holds its user message with no reply —
  recoverable by sending again, and never an empty row.
- Retry is identity-preserving. The allocation retains the committed turn's
  full identity (`clientMessageId`, `userMessageId`, payload); a same-payload
  retry re-presents it — even after the route prop caught up — so the dispatch
  claims the persisted row under the ORIGINAL id with the `{count: 1, tail}`
  token, instead of racing the projection (`{count: 0}` stale rejection) or
  appending a duplicate prompt. Acceptance (`confirmDispatched`, called by the
  send runner after a successful dispatch) consumes the identity, so a later
  identical payload is a genuine new message. A different payload before
  acceptance appends as a normal turn.
- First-turn user messages are briefly provenance-less between commit and the
  claiming run's adoption patch; nothing reads those fields on user messages.
- Interface as test surface: handler composition + validate-all-before-any-
  patch ordering (`convex/chats.test.ts` — the rollback itself is Convex
  mutation transactionality, deliberately not simulated there), provenance
  adoption (`convex/domain/message_branch_writes.test.ts`), the controller's
  first-turn branch, committed-identity retry adoption, and token override
  (`lib/chat-turn/chat-turn-controller.test.ts`), and the retry re-present /
  consume-on-acceptance contract plus client seams
  (`use-chat-operations.test.tsx`, `provider.test.tsx`).
