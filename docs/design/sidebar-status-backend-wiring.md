# Design: wiring sidebar chat-status to real backend state

- Status: proposal (pre-ADR)
- Date: 2026-07-07
- Related: ADR-0004 (per-user subscription seam), ADR-0005 (bounded chat-list
  window), ADR-0008 (no stream-resume read surface), ADR-0009 (durable turn
  runtime), `lib/chat-store/status/sidebar-chat-status.ts` (seam #1 today)

## Goal

Drive every sidebar row's status indicator from real backend state — including
background generations the user navigated away from — plus a genuine new/unread
signal, for both the sidebar and the project view.

## The model: project status onto the chat doc; rows derive from it

Each sidebar row already subscribes to its **chat document** (through the chat-list
queries the sidebar and project view already hold — ADR-0004/0005). So instead of a
separate status feed funneled through a client store, we **project the row's status
onto the chat doc** and let each row derive its indicator from the chat object it is
already rendering:

- A tiny bit of run state is mirrored onto `chats` by the generation lifecycle:
  the current run's live phase (`liveRunStatus`), the last terminal outcome
  (`lastRunEndedAt` / `lastRunStatus`), and an owner-only read cursor
  (`lastReadAt`).
- `useSidebarChatStatus(chat)` derives the indicator from those fields — no
  separate query, no client store of backend statuses, no hydrator.
- **Seam #1 stays**, and only for what it's uniquely good at: raising the *active*
  chat's spinner instantly on send, before the backend transition is visible.

> This replaces an earlier design (a per-user `getActiveRunStatuses` query + a
> `chatReads` table + a client store fanned out by hydrator components). Two review
> rounds showed that machinery was the liability — it bred stale-store, capping,
> and cross-mount-ownership bugs. Projecting onto the chat doc deletes that whole
> class of problem because a row reads the (reactive) object it already has. See
> "Why this shape" at the end.

### Summary of the recommendation

| Concern | Decision |
| --- | --- |
| Cross-chat status | Projected onto `chats` (`liveRunStatus`); rows read their own subscribed chat doc — **no** separate query, store, or hydrator |
| Unread storage | Owner-only `chats.lastReadAt` (chats are single-owner, so per-doc is correct) |
| "Just finished" signal | `generationRuns.completedAt` mirrored to `chats.lastRunEndedAt` + `lastRunStatus` at the terminal mark |
| Row derivation | Pure `deriveChatRowStatus(chat, liveOverride)` from the chat object |
| Active-chat latency | Seam #1 `liveOverride` raises (never lowers) the current chat's indicator instantly |
| Guests / `local-` chats | No chat doc → derives `idle`; active chat still covered by seam #1; `markChatRead` guarded by `isConvexId` |
| Store contract | `useSidebarChatStatus` now takes the `chat` (justified change); the store shrinks to just `liveOverride` |

---

## Schema — four fields on `chats`, no new tables, no new indexes

```ts
// convex/schema.ts — chats table
// Live phase of the chat's current run (set at start/awaiting, cleared at terminal).
liveRunStatus: v.optional(v.union(v.literal("streaming"), v.literal("awaiting"))),
// The run that currently owns this chat's projected status. Set at run start; every
// later projection (awaiting/terminal) only applies if the terminating run IS this
// one — so an OLDER run's late terminal can't clobber a NEWER run's row (see below).
statusRunId: v.optional(v.id("generationRuns")),
// Last *signaling* terminal outcome — completed (→ unread) / failed (→ error).
// aborted/superseded carry no signal, so they only CLEAR liveRunStatus.
lastRunEndedAt: v.optional(v.number()),
lastRunStatus: v.optional(v.union(v.literal("completed"), v.literal("failed"))),
// Read cursor. Semantically owner-only (chats are single-owner), BUT it lives on a
// doc that public reads return — so it MUST be stripped from non-owner reads (see
// "Public reads" below); do not treat "single-owner" as automatically private.
lastReadAt: v.optional(v.number()),
```

No `generationRuns.by_user_status` index and no `chatReads` table — the earlier
design needed both; this one reads nothing but the chat doc rows already subscribe
to. Deleting a chat removes these fields for free (they're on the doc).

## Server — project run transitions onto the chat

The projection is **run-scoped**. Run start claims the chat's status slot
(`statusRunId = this run`); every later projection only applies if the terminating
run still owns the slot, so an older run's late terminal can't overwrite a newer
run's row.

```ts
function chatStatusProjection(status: GenerationRunStatus, now: number) {
  switch (status) {
    case "running":
    case "streaming":         return { liveRunStatus: "streaming" as const }
    case "awaiting_approval": return { liveRunStatus: "awaiting" as const }
    case "completed":         return { liveRunStatus: undefined, lastRunEndedAt: now, lastRunStatus: "completed" as const }
    case "failed":            return { liveRunStatus: undefined, lastRunEndedAt: now, lastRunStatus: "failed" as const }
    case "aborted":           return { liveRunStatus: undefined } // user Stop / supersede — no signal
  }
}

// Guarded application: only the run that owns the slot may project. statusRunId is
// KEPT after terminal, so a same-run completed→failed convergence still applies.
async function projectRunStatusToChat(ctx, run, status, now) {
  const chat = await ctx.db.get(run.chatId)
  if (!chat || chat.statusRunId !== run._id) return // a newer run owns the row → skip
  await ctx.db.patch(run.chatId, chatStatusProjection(status, now))
}
```

Write points (verified against current `chatRuntime.ts`):

- **Run start (claim)** — `prepareGenerationForChat` already patches `args.chatId`
  at `:1379`; add `liveRunStatus: "streaming", statusRunId: runId` there.
- **Every verdict transition** — `applyLifecycleVerdict(ctx, run, verdict, …)` at
  `:429` is the single choke point (it patches `run._id` with `verdict.run.status` at
  `:452`); add `projectRunStatusToChat(ctx, run, verdict.run.status, now)` right
  after. One hook covers awaiting/completed/failed/aborted/superseded — nothing to
  keep in sync per-site. (Confirm the tool-approval-request path routes through
  `applyLifecycleVerdict`; if it patches the run directly, project there too.)

**Why the run-id guard is required (an earlier draft claimed this was structurally
impossible — it is not).** The lifecycle deliberately lets `fail` overwrite
`completed` (`generation_run_lifecycle.ts:187`), so a terminal on an *older* run is
a real `transition`, not an `ignore`. Concrete race: run A completes → the user
starts run B (B claims the slot, projects `streaming`) → A's late `fail` lands. An
unguarded terminal projection would patch the chat `{ liveRunStatus: undefined,
lastRunStatus: "failed" }`, clearing B's spinner and showing A's stale failure. The
`statusRunId` guard makes A's projection a no-op (`chat.statusRunId === B ≠ A`) while
B's own completed→failed still applies (same id). Convex mutations are transactional,
so the read-guard-then-patch is race-free.

## Client — derive from the chat object

The store shrinks to a single shared field (the active-chat override); everything
else is derived per-row from the chat doc.

```ts
// lib/chat-store/status/sidebar-chat-status.ts
export type LiveOverride = { chatId: string; status: SidebarChatStatus } | null
// store: { liveOverride: LiveOverride, setLiveOverride }

/** Pure. `overrideStatus` is the active-tab live status for THIS row (or null). A
 *  non-idle override WINS: it's authoritative for the tab issuing the request —
 *  instant spinner on send, and a local `error` shows even if the backend's
 *  best-effort terminal write lagged. A local idle/ready never lowers the backend,
 *  so a re-entered background run keeps its projected spinner. */
export function deriveChatRowStatus(
  chat: {
    live_run_status?: "streaming" | "awaiting" | null
    last_run_ended_at?: number | null
    last_run_status?: "completed" | "failed" | null
    last_read_at?: number | null
  },
  overrideStatus: SidebarChatStatus | null
): SidebarChatStatus {
  if (overrideStatus && overrideStatus !== "idle") return overrideStatus
  if (chat.live_run_status === "streaming") return "streaming"
  if (chat.live_run_status === "awaiting") return "awaiting"
  if ((chat.last_run_ended_at ?? 0) > (chat.last_read_at ?? 0)) {
    if (chat.last_run_status === "failed") return "error"
    if (chat.last_run_status === "completed") return "unread"
  }
  return "idle"
}

/** Public API — takes the chat the row already has. The selector returns only THIS
 *  row's override slice, so a liveOverride change re-renders only the row it targets,
 *  not every subscribed row. */
export function useSidebarChatStatus(chat: Chat): SidebarChatStatus {
  const overrideStatus = useSidebarChatStatusStore((s) =>
    s.liveOverride?.chatId === chat.id ? s.liveOverride.status : null
  )
  return deriveChatRowStatus(chat, overrideStatus)
}
```

Rows change one line — `useSidebarChatStatus(chat)` instead of
`useSidebarChatStatus(chat.id)` — in `SidebarItem` and `ProjectChatItem`, both of
which already have `chat`. No hydrator, no leaf component, no store ownership, no
unmount cleanup.

Note on the merge: a **non-idle override wins** (not "raise-only"). The earlier
draft's raise-only priority put `streaming` above `error`, which would keep the row
spinning in the very tab whose `useChat` had errored — wrong, and worse because
terminal failure writes are best-effort (`durable-turn-runtime.ts:904/994`). Making
the active tab's live status authoritative fixes it, and still keeps a re-entered
background run spinning (its local status is `idle`, so it doesn't win).

### Reconciliation — active tab's live status wins

The active chat has both a live `useChat` status and a projected `liveRunStatus`.
`useChat` is authoritative for the tab issuing the request, but only when it *has* a
request: sidebar/Link nav remounts `Chat` and does **not** resume the stream
(`use-chat-core.ts:395`, ADR-0008), so a re-entered background run reads `ready`.
Seam #1 writes the active chat's mapped status into `liveOverride`, and the
derivation lets a **non-idle** override win outright (streaming, or `error`), while
an `idle`/`ready` override never lowers the backend (the re-entered background run
keeps its projected `streaming`).

### Mark-read — owner-only, retry-safe

```ts
// convex/chats.ts — NOT ownedChatMutation: opening a public chat you don't own has
// a valid Convex id and ownedChatMutation would THROW. Unread only exists for chats
// you own, so no-op otherwise.
export const markChatRead = authenticatedMutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const chat = await ctx.db.get(chatId)
    if (!chat || chat.userId !== ctx.user._id) return // public / not-owned → no-op
    await ctx.db.patch(chatId, { lastReadAt: Date.now() })
  },
})
```

Client hook (retry-safe — gate on Convex auth to skip the common not-authenticated
throw; a rarer "user not found" during WorkOS→Convex user-row sync is still possible
and is caught. The tracking ref advances **only on success**, so any failure retries
on the next open / run-advance / auth-ready render):

```ts
export function useMarkChatReadOnView(chatId: string | null, lastRunEndedAt?: number | null): void {
  const { isAuthenticated } = useConvexAuth()
  const markChatRead = useMutation(api.chats.markChatRead)
  const markedRef = React.useRef<{ chatId: string | null; endedAt: number }>({ chatId: null, endedAt: 0 })

  React.useEffect(() => {
    if (!chatId || !isConvexId(chatId) || !isAuthenticated) return
    const ended = lastRunEndedAt ?? 0
    const prev = markedRef.current
    const switchedChat = prev.chatId !== chatId
    const runAdvanced = !switchedChat && ended > prev.endedAt
    if (!switchedChat && !runAdvanced) return
    markChatRead({ chatId })
      .then(() => { markedRef.current = { chatId, endedAt: ended } }) // advance only on success
      .catch(() => {}) // best-effort; ref unchanged → a later render/auth-ready retries
  }, [chatId, lastRunEndedAt, isAuthenticated, markChatRead])
}
```

Fire it beside seam #1 in `chat.tsx`, passing the active chat's mirror timestamp
(from `useChat(chatId)`, which carries `last_run_ended_at`). Mark on open, and
again when the active chat's `lastRunEndedAt` advances while active — so a run you
opened mid-stream (or re-entered and watched) counts as read; navigating away
before completion leaves it unread. Backend-driven, independent of `useChat`.

## Status mapping

| Backend (`generationRuns.status`) | Chat projection | Row status |
| --- | --- | --- |
| `running`, `streaming` | `liveRunStatus: "streaming"` | `streaming` (`queued` is never written) |
| `awaiting_approval` | `liveRunStatus: "awaiting"` | `awaiting` |
| `completed` | clear live + `lastRunStatus: "completed"` | `unread` if `lastRunEndedAt > lastReadAt`, else `idle` |
| `failed` | clear live + `lastRunStatus: "failed"` | `error` if `lastRunEndedAt > lastReadAt`, else `idle` |
| `aborted` / superseded | clear live only | `idle` (user-initiated; no signal) |

## Public reads — strip owner-only fields for non-owners

The projection fields live on the chat doc, and **public reads return the whole
doc**: `getAuthorizedChatForRead` returns a `public` chat without owner filtering
(`auth.ts:83`), and `chats.getById` / `getPublicById` return `ctx.chat`. So without
care, a non-owner opening someone's shared chat receives the owner's `lastReadAt`
(and reactive updates when the owner reads it) plus their live/last-run state.

The five projection fields (`liveRunStatus`, `statusRunId`, `lastRunEndedAt`,
`lastRunStatus`, `lastReadAt`) are **owner-only**. Strip them from any read that can
return a chat to a non-owner:

```ts
// convex/chats.ts — apply in getById (readableChatQuery: has ctx.chat + ctx.user)
// and getPublicById (pure-public: always strip).
const OWNER_ONLY = ["liveRunStatus", "statusRunId", "lastRunEndedAt", "lastRunStatus", "lastReadAt"] as const
function stripOwnerStatus<T extends Doc<"chats">>(chat: T) {
  const c = { ...chat }; for (const k of OWNER_ONLY) delete (c as any)[k]; return c
}
// getById: return isOwner ? ctx.chat : stripOwnerStatus(ctx.chat)
```

The owner's own sidebar/project rows come from **owner-scoped** list queries
(`getForCurrentUser`, `getRecentWindowForCurrentUser`, `getPinnedForCurrentUser`,
`getProjectChatsForCurrentUser`), which never return another user's chat — so
stripping only affects the public `getById`/`getPublicById` path. The active chat's
mark-read still works because you only mark read on chats you own (where the fields
are present).

## Guests / local chats

`local-`/`optimistic-` chats have no Convex doc, and guests have no synced identity:

- No chat doc → the mapped `Chat` carries no projection fields → `deriveChatRowStatus`
  returns `idle`. The guest's active chat is still covered by seam #1 (`useChat`).
- `markChatRead` is gated by `isConvexId` (client) and is an `authenticatedMutation`
  (server), so it never fires for a `local-`/optimistic id or a guest. Zero
  regression, no special-casing beyond the id guard the codebase already applies.

## Lifecycle & edge cases

- **Who transitions `unread`.** Nobody stores it — it's derived from
  `lastRunEndedAt > lastReadAt`. The terminal mark sets the former; `markChatRead`
  sets the latter. "Clear on open" = `markChatRead`.
- **`error` stickiness.** `lastRunStatus === "failed" && lastRunEndedAt > lastReadAt`,
  cleared on open by the same `markChatRead`. A silently-vanishing error is worse
  than a persistent one, so it clears on open, not a timer.
- **`aborted` ≠ error.** A user Stop only clears `liveRunStatus`; it never writes the
  mirror. It can't strand a stale `unread` because reaching a chat to abort/regenerate
  requires opening it, which advances `lastReadAt`.
- **Projection drift (the one new risk).** `liveRunStatus` is a mirror of run state,
  so a *failed* "clear at terminal" write would leave a stuck spinner. The blast
  radius is small: the current design already mirrors `lastRunEndedAt` (same class of
  risk on the terminal side), the lifecycle's first-terminal-wins prevents late
  clears, and a stuck flag self-heals on the chat's next turn (which re-projects) or
  the supersede sweep. Reading `generationRuns` directly (the old design) avoided
  drift but cost the entire query+store+hydrator apparatus — not worth it.
- **Multi-tab / multi-device.** The chat doc is reactive across tabs and devices;
  `lastReadAt`/`lastRunEndedAt` are server timestamps (last-writer-wins), so reading
  on any device clears the dot everywhere. `liveOverride` is per-tab (each tab only
  raises the chat it is streaming).
- **Reactivity cost.** The chat doc is patched at turn start (already), awaiting
  (rare), terminal (already, for the mirror), and on open (`lastReadAt`). Streaming
  snapshots patch the run/message docs, **not** the chat doc (`chatRuntime.ts:1479`),
  so there is **no** per-750ms chat-list rerun. On row re-renders, be accurate: the
  rows are **not** `React.memo`'d today and `mapConvexChat` returns new objects when
  the list query updates, so a chat-list change re-renders the whole list (cheap for
  a bounded window). What *is* row-scoped is `liveOverride`: the selector returns only
  this row's slice, so an override change re-renders only the targeted row. Add
  `React.memo` to the rows only if profiling a large window justifies it.

## Why this shape (trade-offs)

- **vs. a separate `getActiveRunStatuses` query + client store + hydrators.** That
  design surfaced status a row doesn't already have, so it needed a store to fan it
  out, ownership tracking to reconcile two mounts, caps + a `readCovered` set to
  bound reads, and unmount cleanup to avoid stale entries. Projecting onto the chat
  doc removes all of it: the row reads the reactive object it already renders. It
  also removes the per-snapshot server-side query recompute.
- **Cost accepted:** a few extra chat-doc patches per turn/open (turn start already
  patches it; opens are user-paced). For a bounded window this is cheaper than the
  distributed state it replaces.
- **Cost accepted:** `liveRunStatus` is a projection that can drift on a dropped
  write (see above) — symmetric with the terminal mirror already in play.
- **Delete-mid-generation** remains a **pre-existing** hazard, now fully orthogonal
  to this feature (no `chatReads` to cascade; `lastReadAt` dies with the doc). The
  run/approval/snapshot orphan cleanup + the loud `finalize()` completion-write
  rejection (`durable-turn-runtime.ts:977`; `requireOwnedGenerationRun` throws once
  the run **or its chat** is gone — `auth.ts:131-135`) is a separate hardening:
  cascade-delete run state in `chats.remove` **and** make terminal marks no-op when
  the target run **or its chat** was deleted by the owner (still throwing on
  auth/not-owner). Track as a fast-follow; no data corruption today.

## Phased rollout

Both phases are increments on the chat doc; one PR of ordered commits, branch green
throughout (or two small PRs at the boundary).

**Phase 1 — cross-chat live status (backend-lit spinners).**
1. `chats.liveRunStatus`; project it at run start / awaiting / terminal-clear.
2. Surface `live_run_status` on the `Chat` type (both mappers).
3. `deriveChatRowStatus` (active branch) + shrink the store to `liveOverride`;
   switch `useSidebarChatStatus(chat)`; seam #1 unchanged; delete the
   `?sidebarStatusPreview` seam.

Ships `streaming` + `awaiting` for every visible row — sidebar and project view —
including background generations you left, with the instant-spinner override intact.

**Phase 2 — unread / error.**
4. `chats.lastRunEndedAt` / `lastRunStatus` / `lastReadAt`; extend the terminal
   projection to set the mirror.
5. Surface the fields; extend `deriveChatRowStatus` (unread/error branch).
6. `markChatRead` (owner no-op) patching `chats.lastReadAt`; `useMarkChatReadOnView`
   (retry-safe) wired in `chat.tsx`.

**Follow-ups (separate):** the delete-mid-generation hardening above; approvals-index
cross-check for `awaiting`; error-dot TTL cap; promoting this + the plan to ADR-0011.
