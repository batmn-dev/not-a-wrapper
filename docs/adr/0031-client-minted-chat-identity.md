# 31. Client-minted chat identity: the thread route commits at Send

- Status: accepted
- Date: 2026-09-02
- Related: ADR-0012 (Atomic first-turn creation — its atomicity section stays
  accepted; its id and navigation sections are superseded here), ADR-0013
  (Back navigation detaches the stream — intact), ADR-0003/0004 (auth seams —
  intact; the chat builders now resolve a public id at the boundary)
- Supersedes: the "navigation happens only after the full commit" and
  server-minted-id parts of ADR-0012

## Context

Sending the first message waited on a server round trip before the thread
route existed: `ensureChatExists` awaited `chats.createWithFirstTurn`, which
minted a Convex `_id`, and only then pushed `/c/<id>`. t3.chat flips its URL
to `/chat/<client uuid>` at the click and fetches the thread afterwards; the
benchmark write-up (`docs/performance/2026-09-02-t3-chat-frontend-analysis.md`)
filed this as the gap to close.

Two shapes of identity coexisted: guests minted `local-<uuid>` on the client,
signed-in users received a Convex id from the server, and a dozen call sites
inspected the id's prefix to decide whether a chat was local, optimistic, or
durable. The route, the sidebar selection, the messages subscription, and the
server's durable-runtime gate each re-derived that classification.

The database is disposable in development and production (AGENTS.md); there
is no compatibility to preserve, so the cleanest design wins over the safest
migration.

## Decision

### 1. One chat identity, minted on the client

A chat's identity is a `crypto.randomUUID()` chosen at Send
(`createChatPublicId`, `lib/chat-store/identity.ts`). It is the route segment,
the value every client-facing Convex function accepts, and the chat
document's required `publicId: v.string()` with a unique `by_public_id`
index. Convex's `_id` stays internal (foreign keys, `ctx.chat._id`) and is
never accepted from the client.

`publicId` resolves to the document exactly once at the boundary
(`convex/lib/auth.ts`: `findChatByPublicId`, `getReadableChatByPublicId`,
`requireOwnedChatByPublicId`). The `readableChatQuery` / `ownedChatQuery` /
`ownedChatMutation` builders take `chatId: v.string()` and hand handlers the
owner-verified `ctx.chat`; the owned builders pass the resolved `_id` through
as `args.chatId`, so nothing behind the boundary holds an unresolved id.
Functions outside the builders (`chats.getPublicById`, `chats.markChatRead`,
`messages.getPublicForChat`, `chatRuntime.prepareGeneration`,
`toolCallLog.log`) resolve through the same helpers. There is no resolver for
Convex-id URLs; a `/c/<convexId>` link is not found.

### 2. Guests and users share the scheme

Guest chats use the same UUID identity. Whether a chat persists in IndexedDB
or Convex is a property of the caller's auth state, never of the id's shape:
`getChatPersistenceMode(isAuthenticated)`. The `local-` and `optimistic-`
chat-id prefixes are gone, with every prefix predicate (`isLocalChatId`,
`isServerChatId`, `isConvexId`, `isOptimisticChatId`). The server's durable
gate is `isAuthenticated && convexToken`; the wire contract validates the
id's UUID shape and nothing else. The IndexedDB chat store holds only guest
chats, so it no longer filters by prefix. One `ensureChatExists`, one route
commit, one rollback, for both.

Consequence: `/c/[chatId]/page.tsx` can no longer tell a guest's local chat
from a durable one server-side, so it has no auth redirect; the mounted Chat
resolves the id against the caller's own store and renders not-found
(`notFound()`) when nothing answers after the authoritative reads settle.

### 3. The route is a derived view of session state

`ChatSessionProvider` is the only History API caller. `commitChatIdentity(id)`
pushes `/c/<id>` synchronously and records the shallow handoff so the mounted
Chat surface is reused (the ADR-0012/0013 no-remount guarantee holds);
`resetChatIdentity()` clears the identity and restores the origin route with
`replaceState`, but only while the browser is still on the pushed entry — a
user who already pressed Back keeps the history they made. Re-committing
while a handoff is pending replaces the entry in place (the one-time re-mint
below). The provider emits `thread_route_committed` at the commit.

In `runSendTurn`, a turn that starts without a chat calls
`firstTurn.begin()` BEFORE the optimistic user row is inserted, so the route,
the optimistic row, and the pending state land in one React batch; the
rate-limit read, creation, and transport dispatch all happen after. The
session commit re-renders the surface with the new id before the rate-limit
read resolves, so `ensureChatExists` consults its allocation before the
`chatId` prop.

### 4. Idempotent creation

`chats.createWithFirstTurn` takes `publicId` and treats it as the idempotency
key: an existing chat for the same user whose first message carries the same
`clientMessageId` is returned (with its bound attachments re-described); any
other holder (another user, or a different first turn) is a typed
`ConvexError({ code: "chat_public_id_conflict" })`. The client re-mints
exactly once, re-commits the route in place, and retries; a second conflict
is a plain failure. The mutation transaction is the collision guard. The
ADR-0012 atomic body (chat, bound attachments, first user message) is
unchanged and still returns no `_id` to the client.

### 5. Rollback contract

Before the creation lands, any refusal — rate limit, prompt size, auth,
attachment binding, mutation rejection, network failure, the surface leaving
the send mid-flight — runs ONE rollback in the controller's `finally`:
`firstTurn.rollback()` resets the session identity (route restored) and
clears the allocation; the controller removes the optimistic row; the
Composer restores the draft and attachments because the turn reports
not-accepted; the error shows in place (toast). After the creation lands
(`chatCommitted`), nothing rolls back: a later dispatch failure keeps the
chat at its route with the error in place, exactly as ADR-0012 allows, and a
same-payload retry re-presents the committed turn. A user Stop is never a
failure and never restores the draft.

### 6. No remount, no clobber

The Chat surface is layout-owned and the commit is shallow, so nothing
remounts. The messages subscription enables for the new id immediately and
delivers an empty path until the mutation lands; the existing selected-path
projection preserves in-flight optimistic sends and the allocation ref
guards the retry, so no new mechanism was added.

### 7. Thread chunk

There is no thread route chunk to prefetch: `/c/[chatId]` is a null server
segment and the Chat surface (thread, composer, markdown pipeline) ships in
the layout's first-load bundle, so the route commit never waits on a
download. Route-level code splitting stays a separate TODO; if it lands, the
prefetch belongs beside `firstTurn.begin()`.

## Alternatives rejected

- **Keep server-minted ids and push the route before acceptance returns**:
  still one round trip in the visible path, and the route would name a chat
  that may never exist without a client-owned identity to roll back.
- **Keep a `local-` prefix for guests as the persistence class**: a second
  identity scheme and the prefix predicates that came with it; the auth
  state already answers the question at every site.
- **Dual resolvers accepting both `_id` and `publicId`**: compatibility for
  data the owner declared disposable.
- **`history.back()` on rollback**: asynchronous, and wrong if the user
  navigated during the in-flight send; `replaceState` on the pushed entry
  is exact.

## Consequences

- Every existing chat row is invalid under the required `publicId`; the
  development deployment was wiped and
  `convex/migrations/2026-09-02-client-minted-chat-identity.json` records the
  production wipe the deploy performs. Old `/c/<convexId>` links 404.
- `_id` still rides read results (chat docs, `message.chatId`); it is opaque
  to the client, which maps `id` from `publicId` in `convexChatToChat`. It is
  not stripped from every list projection — the boundary rule is that
  clients never SEND it.
- A signed-out visitor on a durable chat URL sees not-found instead of a
  redirect to `/`.
- Harness: `thread_route_committed` and `send_to_thread_route_committed`
  (`benchmarks/chat-performance/browser`, `docs/performance/metric-dictionary.md`).
- Tests: session provider (commit/rollback/handoff), `createWithFirstTurn`
  idempotency and conflict, and the publicId boundary helpers.
