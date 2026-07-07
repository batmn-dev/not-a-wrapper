# Design: wiring sidebar chat-status to real backend state

- Status: proposal (pre-ADR)
- Date: 2026-07-07
- Related: ADR-0004 (per-user subscription seam), ADR-0005 (bounded chat-list
  window), ADR-0008 (no stream-resume read surface), ADR-0009 (durable turn
  runtime), `lib/chat-store/status/sidebar-chat-status.ts` (seam #1 today)

## Goal

Drive every sidebar row's status indicator from real backend state — including
background generations the user navigated away from — plus a genuine
new/unread signal, **without changing the store's public contract** and without
resurrecting the per-chat resume read surface ADR-0008 deleted.

## Summary of the recommendation

One aggregated per-user reactive query funnels into the **existing** Zustand
store via a single hydration hook mounted once in the sidebar; rows keep reading
`useSidebarChatStatus(chatId)` unchanged. Unread/error are derived **client-side**
by joining the already-subscribed chat list against a tiny per-user read-cursor
query — precisely scoped to the chats the sidebar can actually show.

| Concern | Decision |
| --- | --- |
| Cross-chat feed | **One** aggregated `getActiveRunStatuses` subscription → store; **not** per-row |
| New index | `generationRuns.by_user_status ["userId","status"]` (index build only, no migration) |
| Source of truth (active chat) | Live `useChat` (seam #1) **owns the active chatId**; backend owns every other chat |
| Unread storage | New `chatReads` table `{userId, chatId, lastReadAt}` (isolated writes), **not** a field on `chats` |
| "Just finished" signal | `generationRuns.completedAt` mirrored to `chats.lastRunEndedAt` + `lastRunStatus` on terminal marks |
| Unread derivation | Client join: `lastRunEndedAt > (lastReadAt ?? 0)` over the loaded chat list |
| Guests / `local-` chats | `usePerUserQuery` gate returns `"skip"`; `markChatRead` guarded by `isConvexId` — degrades to seam #1 only |
| Store contract | Unchanged; seam #2 is additive and uses the existing `setChatStatus`/`clearChatStatus` setters |

---

## 1. Cross-chat status feed — one aggregated query, not per-row

**Recommendation: a single per-user reactive query, fanned out to rows through
the store.**

Convex re-runs a `useQuery` subscription (and re-renders its subscriber)
whenever the query *result* changes. The winning shape:

- **One** subscription mounted at the sidebar root (`getActiveRunStatuses`)
  returns a compact `{chatId, status}[]` for the user's live runs.
- A hydration effect writes those into the **existing** store.
- Rows keep subscribing to the store with the existing fine-grained selector
  (`useSidebarChatStatus(chatId)`), so **only the rows whose status actually
  changed re-render** — not the whole list.

Per-row subscriptions (each row runs its own `useQuery`) would mean N
subscriptions and N server-side executions for a bounded window of N≈20–50
(ADR-0005). The aggregate is strictly cheaper: **1** subscription, and the
fan-out to rows is client-side through the store at zero network cost. It also
has the smallest blast radius — it changes neither the row components nor the
store contract; it just adds the second writer the store's docblock already
reserves.

The query stays cheap because the read is bounded to *active* runs via a new
composite index (active runs per user are typically 0–3):

```ts
// convex/schema.ts — generationRuns: add one index (no data migration)
.index("by_user_status", ["userId", "status"])
```

```ts
// convex/sidebarStatus.ts
import { maybeAuthQuery } from "./lib/authedFunctions"

// `queued` is intentionally omitted — runs are inserted directly as `running`
// (ADR-0008 deleted the queued write path); don't wait for a state that never lands.
const ACTIVE_RUN_STATUSES = ["running", "streaming", "awaiting_approval"] as const

export const getActiveRunStatuses = maybeAuthQuery({
  args: {},
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return [] // guests get nothing; seam #1 covers their active chat

    const rows = (
      await Promise.all(
        ACTIVE_RUN_STATUSES.map((status) =>
          ctx.db
            .query("generationRuns")
            .withIndex("by_user_status", (q) =>
              q.eq("userId", user._id).eq("status", status)
            )
            .collect()
        )
      )
    ).flat()

    // Latest active run wins per chat (a regen can briefly overlap the prior run).
    const byChat = new Map<string, { status: string; updatedAt: number }>()
    for (const r of rows) {
      const prev = byChat.get(r.chatId)
      if (!prev || r.updatedAt > prev.updatedAt) {
        byChat.set(r.chatId, { status: r.status, updatedAt: r.updatedAt })
      }
    }
    return [...byChat].map(([chatId, v]) => ({
      chatId,
      status: v.status === "awaiting_approval" ? ("awaiting" as const) : ("streaming" as const),
    }))
  },
})
```

Note: `toolApprovalRequests.by_user_status` (pending) is already indexed and is
an equivalent source for `awaiting`; folding it in is optional since the run's
`awaiting_approval` status already carries the signal from a single source of
truth (the run).

## 2. Source-of-truth reconciliation — ownership split by active chatId

The active chat has **both** a live `useChat` status (seam #1,
`usePublishActiveChatStatus`) and a backend run row (it's `streaming` server-side
too). Two writers to one last-writer-wins map would flicker. Resolve it by
**ownership, not by merging**:

> **The live `useChat` status owns the currently-active chatId. The backend feed
> owns every other chat.**

The hydration hook reads the active chatId (from `useChatSession()`, the same
hook `chat.tsx` uses) and **excludes it** from its writes. `useChat` is
local and lower-latency, so it's authoritative for the tab you're in.

Handoffs:

- **Stream completes while viewing** — `useChat → ready`, seam #1 maps to `idle`
  and clears the row; `markChatRead` fires for the active chat (see §3) so the
  completion is already seen → backend leaves it `idle`. No dot. ✅
- **Navigate away mid-stream** — active chatId changes; seam #1's cleanup clears
  the old row, then the backend feed (no longer excluding it) asserts its true
  background state: still `streaming` → the row keeps spinning. ✅
- **Background run finishes after you left** — it drops out of the active query;
  `completedAt` was mirrored to the chat doc; you haven't read it since →
  `unread` (blue dot). ✅

The only seam is a possible sub-frame gap on navigate-away as the two effects
converge; acceptable, and invisible in practice. (Alternative if it ever shows:
make the hook the sole writer and pass the live status through a dedicated store
field — more coupling, not worth it day one.)

## 3. Unread data model — a `chatReads` table + a completion mirror

Two timestamps define unread: **when the last run finished** and **when the user
last read the chat**. `unread = lastRunEndedAt > (lastReadAt ?? 0)`.

**Finished side — mirror `completedAt` onto the chat doc.** `completedAt` is the
right stamp (set on every terminal transition, unset for `awaiting_approval`,
currently unread in prod). Rather than scan runs per chat, mirror it forward at
the terminal mark, where `ctx.chat` is already in hand
(`ownedGenerationRunMutation`, #105):

```ts
// convex/schema.ts — chats: add a completion mirror
lastRunEndedAt: v.optional(v.number()),
lastRunStatus: v.optional(
  v.union(v.literal("completed"), v.literal("failed"), v.literal("aborted"))
),
```

```ts
// in markGenerationRunCompleted/Failed/Aborted *ForChat handlers, on settle:
await ctx.db.patch(ctx.chat._id, {
  lastRunEndedAt: now,
  lastRunStatus: verdict.run.status, // "completed" | "failed" | "aborted"
})
```

This rides the chat-list subscription the sidebar **already** holds, so the
"finished" side needs no new query and no new `generationRuns` index. It's also
*precisely* scoped: unread only matters for chats visible in the sidebar (the
bounded window + pinned), which are exactly the chats already in that
subscription. A chat outside the window can't show a dot regardless.

**Read side — a dedicated table (not a field on `chats`).** Keep the frequent
"mark read" write off the chat-list subscription:

```ts
// convex/schema.ts
chatReads: defineTable({
  userId: v.id("users"),
  chatId: v.id("chats"),
  lastReadAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_chat", ["userId", "chatId"]),
```

A field on `chats` would re-run the whole chat-list query on every open; a
separate table means opening a chat invalidates only the tiny reads query.

```ts
// convex/sidebarStatus.ts
export const getChatReads = maybeAuthQuery({
  args: {},
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return []
    const rows = await ctx.db
      .query("chatReads")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()
    return rows.map((r) => ({ chatId: r.chatId, lastReadAt: r.lastReadAt }))
  },
})

export const markChatRead = ownedChatMutation({
  args: {}, // chatId consumed + ownership-verified by the builder
  handler: async (ctx) => {
    const now = Date.now()
    const existing = await ctx.db
      .query("chatReads")
      .withIndex("by_user_chat", (q) =>
        q.eq("userId", ctx.user._id).eq("chatId", ctx.chat._id)
      )
      .unique()
    if (existing) await ctx.db.patch(existing._id, { lastReadAt: now })
    else await ctx.db.insert("chatReads", {
      userId: ctx.user._id, chatId: ctx.chat._id, lastReadAt: now,
    })
  },
})
```

**The write on open, and "does mid-stream open count as read?"** Fire
`markChatRead` when a chat is opened **and again when the active chat's stream
completes** (observable via `useChat → ready`). So:

- Open a settled chat → read, no dot.
- Open mid-stream and stay → on completion you're still active → second
  `markChatRead` → **not** unread. ✅ (mid-stream open counts as read *once the
  run you watched finishes*.)
- Navigate away before completion → no final mark → `completedAt > lastReadAt` →
  unread. ✅

Because both sides are server timestamps with last-writer-wins semantics, this
is inherently multi-device/multi-tab safe: reading on any device clears the dot
everywhere reactively.

## 4. Lifecycle & edge cases

- **Who transitions `unread`.** Nobody stores it — it's *derived* from two
  timestamps. The terminal lifecycle mark sets `lastRunEndedAt`; the client
  `markChatRead` sets `lastReadAt`. "Clear on open" = `markChatRead`.
- **`error` stickiness.** Fold error into the same derivation so it survives past
  the live window: `lastRunStatus === "failed" && lastRunEndedAt > lastReadAt →
  error`, cleared on open by the same `markChatRead`. A silently vanishing error
  is worse than a persistent one, so it clears on open, not on a timer. (Optional
  belt-and-suspenders: a client-side TTL cap.)
- **`aborted` ≠ error.** A user Stop is intentional; map `aborted → idle` (or
  `unread` if you want to surface stopped-with-partial-output). Do **not** show
  the red `error` dot for a deliberate stop.
- **Multi-tab.** Every Convex subscription is per-tab and reactive → all tabs
  converge. Active-chat ownership is per-tab (each tab owns the chat *it* shows);
  two tabs on different chats each own their own and agree on the rest.
- **Superseded runs** already terminate as `aborted` with `completedAt` set, so
  they flow through the same path (→ idle/unread, never a spurious spinner).

## 5. Guests / local chats

`local-` chatIds have no Convex doc, and guests have no synced Convex identity:

- `usePerUserQuery` returns `"skip"` until `isConvexAuthenticated` → the whole
  backend feed is inert for guests. Their only live chat is the one they're
  viewing, already covered by seam #1 (`useChat`). **Zero regression.**
- `local-` chats never produce run docs and aren't in the chat list as Convex
  docs → they never appear in any backend result.
- `markChatRead` is guarded by the existing `isConvexId(chatId)` heuristic
  (mirroring `use-chat.ts:26`), so it's never called for a `local-`/optimistic
  id.

No special-casing beyond the id guard the codebase already applies.

## 6. Status mapping

| Backend (`generationRuns.status`) | Sidebar status | Notes |
| --- | --- | --- |
| `running`, `streaming` | `streaming` | `queued` never written |
| `awaiting_approval` | `awaiting` | also derivable from `toolApprovalRequests.by_user_status` |
| `completed` + unseen | `unread` | `lastRunEndedAt > lastReadAt` |
| `completed` + seen | `idle` | — |
| `failed` + unseen | `error` | sticky until open |
| `aborted` | `idle` | user-initiated; not an error |

`generationRuns` is the source of truth (exactly one run per assistant message
per attempt, latest-per-chat via the run rows). `messages.status` /
`messages.by_chat_status` mirror it per-message and are a fallback only — a chat
can hold many messages, so the run is the cleaner single signal.

---

## The store-hydration hook (seam #2)

Added to `lib/chat-store/status/sidebar-chat-status.ts`; **uses only the existing
setters**, so the public contract is untouched. Mounted once where
`useSidebarChatStatusPreview` sits today (`SidebarExpandedNav`), and replaces it.

```ts
export function useHydrateSidebarChatStatuses(activeChatId: string | null): void {
  const { data: activeRuns } = usePerUserQuery(api.sidebarStatus.getActiveRunStatuses)
  const { data: reads } = usePerUserQuery(api.sidebarStatus.getChatReads) // Phase 2
  const { pinnedChats, nonPinnedChats } = useChats()                      // Phase 2
  const prevRef = React.useRef<Record<string, SidebarChatStatus>>({})

  React.useEffect(() => {
    const next: Record<string, SidebarChatStatus> = {}

    // Phase 1 — live/active (highest priority)
    for (const { chatId, status } of activeRuns ?? []) next[chatId] = status

    // Phase 2 — unread / error over the loaded (visible) chat list
    const readAt = Object.fromEntries((reads ?? []).map((r) => [r.chatId, r.lastReadAt]))
    for (const c of [...pinnedChats, ...nonPinnedChats]) {
      if (next[c.id]) continue // an active run already owns this row
      const ended = c.lastRunEndedAt ?? 0
      if (ended <= (readAt[c.id] ?? 0)) continue
      if (c.lastRunStatus === "failed") next[c.id] = "error"
      else if (c.lastRunStatus === "completed") next[c.id] = "unread"
    }

    // The active chat is owned by seam #1 — never write it here.
    if (activeChatId) delete next[activeChatId]

    // Reconcile against the previous backend map with the existing store API.
    const store = useSidebarChatStatusStore.getState()
    for (const [id, s] of Object.entries(next)) store.setChatStatus(id, s)
    for (const id of Object.keys(prevRef.current)) {
      if (!(id in next) && id !== activeChatId) store.clearChatStatus(id)
    }
    prevRef.current = next
  }, [activeRuns, reads, pinnedChats, nonPinnedChats, activeChatId])
}
```

Wiring detail: add `lastRunEndedAt` / `lastRunStatus` to the mapped `Chat` type
(`mapConvexChat` in `lib/chat-store/chats/provider.tsx`). No change to
`usePublishActiveChatStatus`.

## Trade-offs

- **Chat-doc mirror vs. dedicated index.** Mirroring `completedAt` onto `chats`
  adds one patch per terminal mark and re-runs the chat-list query on completion
  (it already re-runs on turn-start, so ~2×/turn — negligible). The alternative,
  a `by_user_ended` index + a separate completions query, buys unread for chats
  *outside* the sidebar window — which can't render a dot anyway. Mirror wins.
- **One aggregate query vs. per-row.** The aggregate couples all active rows to
  one subscription, but the store selector keeps re-renders row-local. Per-row
  would isolate subscriptions at the cost of N of them. Aggregate wins at every N
  the bounded window allows.
- **Derived unread vs. stored flag.** Deriving from two timestamps is
  self-healing and multi-tab-correct with no transition bookkeeping; the cost is
  the client join, which is trivial over the loaded window.
- **New `by_user_status` index.** Small, no migration; the only unavoidable
  schema cost of a per-user active-run read (existing `by_user` is unbounded per
  user; `by_status` is cross-tenant).

## Phased rollout

**Phase 1 — cross-chat streaming (backend-lit spinners).**
1. Add `generationRuns.by_user_status` index.
2. `convex/sidebarStatus.ts`: `getActiveRunStatuses`.
3. `useHydrateSidebarChatStatuses` (Phase-1 branch only) mounted in the sidebar;
   remove `useSidebarChatStatusPreview`.
4. Reconciliation: exclude the active chatId (seam #1 keeps owning it).

Ships `streaming` + `awaiting` for every chat, including background generations.

**Phase 2 — unread / error.**
5. Add `chats.lastRunEndedAt` / `lastRunStatus`; patch them in the terminal
   `*ForChat` marks; surface them through `mapConvexChat` + the `Chat` type.
6. Add `chatReads` table; `getChatReads` + `markChatRead`.
7. Call `markChatRead` on chat open and on active-chat stream completion (guard
   with `isConvexId`).
8. Extend the hook's join to derive `unread` / `error`.

**Phase 3 (optional) — polish.** approvals-index cross-check for `awaiting`;
error TTL cap; prune stale `chatReads`; fold seam #1 into the hook if the
navigate-away seam ever flickers.
