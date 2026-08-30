# 3. Convex auth is structural: handlers go through authenticated builders

- Status: accepted
- Date: 2026-06-23
- Context: Architecture deepening — Convex auth seam; branch `darknight/batarang`

## Context

`convex/lib/auth.ts` already exposed `requireCurrentUser` / `requireOwnedChat` /
`requireOwnedProject` / `getAuthorizedChatForRead`, but they were a library you
had to remember to call. The seam was routinely bypassed: ~33 handlers across 15
files called `ctx.auth.getUserIdentity()` inline and re-derived the
identity→user→ownership sequence by hand. Six files never touched the helpers at
all.

The bypass was not hypothetical. The contract had already drifted —
`mcpServers` threw `"Server not found"` where ownership failures should read
`"Not authorized"`, and `messages.clearForChat` hand-copied the whole ownership
block. Each new bypass handler was one forgotten ownership comparison away from
an IDOR. The deletion test confirmed the seam carried no structural weight:
deleting `convex/lib/auth.ts` left most handlers compiling, because they never
imported it.

## Decision

Introduce `convex/lib/authedFunctions.ts`: a set of function builders, built on
`convex-helpers` `customQuery`/`customMutation`, that resolve auth **before** the
handler body and inject it into `ctx`. A handler defined with `ownedChatMutation`
cannot run without an owner-verified `ctx.chat`.

The builder set covers the authorization taxonomy:

- `authenticatedQuery` / `authenticatedMutation` — inject required `ctx.user`.
- `maybeAuthQuery` / `maybeAuthMutation` — inject `ctx.user | null`, never throw
  (authenticated reads / writes that degrade for signed-out callers).
- `optionalAuthQuery` / `optionalAuthMutation` — inject `ctx.identity` **and**
  `ctx.user`, both nullable, for anonymous paths (usage, rate limits) that must
  distinguish a guest from an unsynced user.
- `identityQuery` / `identityMutation` — inject a required `ctx.identity` without
  a user row, for self-identity-match handlers and the create-user bootstrap.
- `readableChatQuery` — inject `ctx.chat | null` honoring the public-chat read
  exception; `ownedChatQuery` — strict owner-only read.
- `ownedChatMutation` / `ownedProjectMutation` / `ownedProjectQuery` /
  `ownedMcpServerMutation` / `ownedMcpServerQuery` — inject the ownership-checked
  resource (`ctx.chat` / `ctx.project` / `ctx.server`) plus `ctx.user`. Each
  declares its resource id arg and passes it through, so handlers keep using it
  and simply drop their own check.

The builders reuse the `convex/lib/auth.ts` helpers as their injection bodies;
`requireOwnedMcpServer` was added there with the canonical contract, which fixes
the `mcpServers` `"Server not found"` drift. `chatRuntime`'s duplicate
`requireChatOwner` now delegates to `requireOwnedChat`, leaving one owned-chat
implementation.

A `no-restricted-syntax` lint rule bans `ctx.auth.getUserIdentity()` outside
`convex/lib/`, so the seam stays un-bypassable. After the migration no raw call
remains outside `convex/lib/`.

`convex-helpers` was promoted from a transitive dependency to a direct one (it
ships the well-typed `customFunctions` machinery that preserves end-to-end
inference; hand-rolling it was the rejected alternative).

## Consequences

- Auth is structural: a new handler is authenticated and ownership-checked by
  construction, and the lint rule blocks regressions. Forgetting the check stops
  being possible rather than being a review catch.
- Auth logic concentrates in `convex/lib/auth.ts` (the builder internals) — proven once
  per helper, inherited by every handler. Per-handler auth tests collapse; the
  helper tests (including the new owned-MCP-server contract) are the coverage.
- Deliberately out of scope: `internalQuery`/`internalMutation` (no client
  identity), `httpAction` and the chat-route token path (a separate INTERFACE),
  pure-public reads (`getPublicById`, `getPublicForChat`), and per-row ownership
  predicates (`deleteFile`, `toggleApproval`) that are an inline row check rather
  than a builder resource.
- A latent file-URL IDOR was fixed in the same pass: `files.getUrl` returned a
  storage URL for any id with no auth; it now requires the caller to own a
  chatAttachment backed by that id.
- `mcpToolCallLog` was removed after a caller sweep found no references; the
  live module remains `toolCallLog`.

## Addendum (2026-07-06): run-scoped builder

The seam was extended to the **Generation run** mutations, which the original
pass left hand-rolled: `markGenerationRunCompleted`/`Failed`/`Aborted`,
`updateAssistantSnapshot`, `createToolApprovalRequest`, and
`recordToolInvocations` each repeated a `db.get(runId)` → existence-check →
`requireChatOwner(run.chatId)` prologue. A new `ownedGenerationRunMutation`
builder (over a new `requireOwnedGenerationRun` helper in `convex/lib/auth.ts`) keys on
`runId`, resolves ownership **transitively** through `run.chatId`, and injects
`ctx.run`/`ctx.chat`/`ctx.user`. Handler bodies became auth-free logic cores
taking the injected `AuthenticatedRunOwner`.

The load-bearing win is the same one this ADR is about, one level deeper: two of
those handlers hand-validated a client-supplied `chatId` against the run
(`run.chatId !== args.chatId`). Deriving the chat from the run makes that
cross-check **structurally unrepresentable** — there is no second id to
disagree with — so the redundant `chatId` args were dropped from the mutations
and their durable-runtime call sites. Behavior is preserved: the builder still
throws `Run not found` before the auth check, matching the pre-seam handlers.

The `requireChatOwner` delegating alias noted above was removed in this pass;
`prepareGenerationForChat` (chat-scoped — it creates the run) now calls
`requireOwnedChat` directly. `approveToolCall`/`denyToolCall` stay outside the
builder: they own by `approval.userId`, a self-identity-match shape. Auth is
covered once, at the `requireOwnedGenerationRun` helper tests, not per handler.
