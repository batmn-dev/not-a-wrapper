# Implementation plan: sidebar chat-status ← backend state

Companion to [`sidebar-status-backend-wiring.md`](./sidebar-status-backend-wiring.md).
Executable, file-by-file, in two shippable phases. Phase 1 lights up cross-chat
streaming; Phase 2 adds unread/error. Each phase is independently mergeable and
leaves `main` green.

Grounding anchors (verified against current code):
- Store + seams: `lib/chat-store/status/sidebar-chat-status.ts`
- Sidebar mount: `app/components/layout/sidebar/app-sidebar.tsx:307` (`SidebarExpandedNav`)
- Reconciliation seam #1: `app/components/chat/chat.tsx:154` (`usePublishActiveChatStatus`)
- Query template: `convex/chats.ts` (`maybeAuthQuery` + `by_user` index) via `usePerUserQuery`
- Terminal settle patches: `convex/chatRuntime.ts:452` (`applyLifecycleVerdict`), `:1563` (`markGenerationRunCompletedForChat`), `:1181` (`resolveApprovalResponses`)
- Chat mappers: `lib/chat-store/chats/sidebar-window.ts:18` (`mapConvexChat`), `lib/chat-store/types.ts:56` (`convexChatToChat`)
- Guards: `isConvexId` (`types.ts:94`), `isLocalChatId` (`identity.ts:58`)

Convention notes: all reactive reads go through `usePerUserQuery` (bare
`useQuery` is ESLint-banned); per-user server functions take **no** `userId` arg
(derive `ctx.user` via `maybeAuthQuery`); package manager is **bun**.

---

## Phase 1 — cross-chat streaming

Outcome: every sidebar row (not just the active chat) shows the spinner while its
generation runs in the background, and the amber dot while awaiting approval —
sourced from `generationRuns`, funneled through the existing store.

### 1.1 Schema: add the per-user active-run index

`convex/schema.ts`, `generationRuns` table (currently ends at `:184`), add one index:

```ts
  .index("by_chat", ["chatId"])
  .index("by_user", ["userId"])
  .index("by_status", ["status"])
  .index("by_chat_updated", ["chatId", "updatedAt"])
  .index("by_user_status", ["userId", "status"]), // NEW
```

Index build only — no data migration. This is a schema **expansion**, so the
production preflight contraction-guard passes. `userId` is optional on the table
(anonymous runs use `anonymousId`); the index simply never matches a user `eq`
for those rows, which is correct — guests get no cross-chat feed.

### 1.2 New Convex module: the active-run query

`convex/sidebarStatus.ts` (new):

```ts
import { maybeAuthQuery } from "./lib/authedFunctions"

// `queued` is intentionally absent — runs are inserted directly as `running`
// (ADR-0008 removed the queued write path). `awaiting_approval` is active too:
// it keeps activeStreamId and has not settled.
const ACTIVE_RUN_STATUSES = ["running", "streaming", "awaiting_approval"] as const

/**
 * The user's live runs, one row per chat (latest wins), mapped to the sidebar's
 * semantic status. Bounded by `by_user_status` to only non-terminal runs, so the
 * read stays cheap regardless of run history size. Seam #2 of the sidebar status
 * store (see lib/chat-store/status/sidebar-chat-status.ts).
 */
export const getActiveRunStatuses = maybeAuthQuery({
  args: {},
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return [] // guests / signed-out: seam #1 still covers the active chat

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

    // A regeneration can briefly overlap the prior run for the same chat; the
    // most-recently-updated active run is the one the row should reflect.
    const byChat = new Map<string, { status: string; updatedAt: number }>()
    for (const r of rows) {
      const prev = byChat.get(r.chatId)
      if (!prev || r.updatedAt > prev.updatedAt) {
        byChat.set(r.chatId, { status: r.status, updatedAt: r.updatedAt })
      }
    }
    return [...byChat].map(([chatId, v]) => ({
      chatId,
      status:
        v.status === "awaiting_approval"
          ? ("awaiting" as const)
          : ("streaming" as const),
    }))
  },
})
```

Returns a small, stable `{ chatId, status }[]` — the subscription only re-runs
when the active set changes.

### 1.3 Store module: pure merge fn + hydration hook

`lib/chat-store/status/sidebar-chat-status.ts`. **No change to the store's public
contract** (`setChatStatus`/`clearChatStatus`/`useSidebarChatStatus` unchanged).
Add two exports. Write the pure fn in its Phase-2-complete form now (Phase 1
simply passes empty `chats`/`reads`) so Phase 2 needs no rewrite:

```ts
import { api } from "@/convex/_generated/api"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { useChats } from "@/lib/chat-store/chats/provider"

export type SidebarStatusInputs = {
  activeRuns: { chatId: string; status: "streaming" | "awaiting" }[]
  chats: {
    id: string
    last_run_ended_at?: number | null
    last_run_status?: "completed" | "failed" | "aborted" | null
  }[]
  reads: Record<string, number> // chatId -> lastReadAt (epoch ms)
  activeChatId: string | null
}

/**
 * The reconciliation brain (pure, unit-tested). Precedence: a live run wins;
 * else an unseen terminal outcome (failed → error, completed → unread); else
 * idle. The active chat is owned by seam #1 (usePublishActiveChatStatus), so it
 * is never emitted here.
 */
export function deriveSidebarStatuses(
  input: SidebarStatusInputs
): Record<string, SidebarChatStatus> {
  const next: Record<string, SidebarChatStatus> = {}

  for (const r of input.activeRuns) next[r.chatId] = r.status // live wins

  for (const c of input.chats) {
    if (next[c.id]) continue // an active run already owns this row
    const ended = c.last_run_ended_at ?? 0
    if (ended <= (input.reads[c.id] ?? 0)) continue // seen (or never ran) → idle
    if (c.last_run_status === "failed") next[c.id] = "error"
    else if (c.last_run_status === "completed") next[c.id] = "unread"
    // aborted → idle (user-initiated Stop is not a failure)
  }

  if (input.activeChatId) delete next[input.activeChatId] // seam #1 owns it
  return next
}

/**
 * Seam #2: one Convex subscription → the store. Mounted once in the sidebar.
 * Reconciles against the previous backend-owned map with the existing setters,
 * so only genuinely-changed rows re-render (the store no-ops equal writes).
 */
export function useHydrateSidebarChatStatuses(activeChatId: string | null): void {
  const { data: activeRuns } = usePerUserQuery(api.sidebarStatus.getActiveRunStatuses)
  // Phase 2 wires these two; Phase 1 leaves them empty.
  const reads: Record<string, number> = {}
  const chats: SidebarStatusInputs["chats"] = []
  const prevRef = React.useRef<Record<string, SidebarChatStatus>>({})

  React.useEffect(() => {
    const next = deriveSidebarStatuses({
      activeRuns: activeRuns ?? [],
      chats,
      reads,
      activeChatId,
    })
    const store = useSidebarChatStatusStore.getState()
    for (const [id, s] of Object.entries(next)) store.setChatStatus(id, s)
    for (const id of Object.keys(prevRef.current)) {
      if (!(id in next) && id !== activeChatId) store.clearChatStatus(id)
    }
    prevRef.current = next
  }, [activeRuns, activeChatId])
}
```

Delete `useSidebarChatStatusPreview` (and its `?sidebarStatusPreview` docblock)
once 1.4 lands — the real feed supersedes it.

### 1.4 Mount the hook; retire the preview

`app/components/layout/sidebar/app-sidebar.tsx`, `SidebarExpandedNav` (~`:299-307`):

```ts
// remove:
const previewChatIds = useMemo(...)
useSidebarChatStatusPreview(previewChatIds)
// replace with:
useHydrateSidebarChatStatuses(data.currentChatId)
```

`data.currentChatId` is already on `AppSidebarData` (`app-sidebar.tsx:272`). The
hook calls `useChats()` in Phase 2; `SidebarExpandedNav` is inside `ChatsProvider`
already, so no provider move is needed.

### 1.5 Regenerate Convex types

```
bunx convex codegen   # or the running `convex dev` picks it up
```

Makes `api.sidebarStatus.getActiveRunStatuses` typecheck.

### 1.6 Tests (Phase 1)

- `convex/sidebarStatus.test.ts` (new, `convex-test`): seed 2 chats with
  `streaming` / `awaiting_approval` runs + one `completed` run for a third → assert
  `getActiveRunStatuses` returns `streaming`/`awaiting` for the first two and omits
  the third; assert latest-active-run-wins when two active runs share a chat.
- `lib/chat-store/status/sidebar-chat-status.test.ts` (new): `deriveSidebarStatuses`
  — active `streaming`/`awaiting` map through; `activeChatId` is excluded even when
  it has an active run. (Unread/error cases arrive with Phase 2.)

Keep it to these — the pure fn is the risky surface; the query is a thin index read.

### Phase 1 acceptance
Start a generation in chat A, navigate to chat B: A's row keeps spinning. Trigger
a tool-approval in a background chat: its row shows the amber dot. Sign out: no
errors, no indicators. The active chat's spinner still comes from seam #1 (no
double-write — the hook excludes `activeChatId`).

---

## Phase 2 — unread / error

Outcome: a background generation that finishes while you're elsewhere leaves a
blue "unread" dot until you open it; a background failure leaves a red "error"
dot; opening (or finishing while viewing) clears it — across tabs and devices.

### 2.1 Schema: completion mirror + read cursors

`convex/schema.ts`.

`chats` table — add two fields (the "finished" side, riding the existing
chat-list subscription):

```ts
    updatedAt: v.number(),
    // Sidebar unread/error mirror: the latest *terminal* run's settle time +
    // outcome. Only completed/failed are written (aborted → no sidebar signal).
    lastRunEndedAt: v.optional(v.number()),
    lastRunStatus: v.optional(
      v.union(v.literal("completed"), v.literal("failed"))
    ),
```

New `chatReads` table — the per-(user,chat) read cursor (the "read" side, kept off
the chat-list subscription so opens don't re-run it):

```ts
  chatReads: defineTable({
    userId: v.id("users"),
    chatId: v.id("chats"),
    lastReadAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_chat", ["userId", "chatId"]),
```

Both are expansions — preflight-safe.

### 2.2 Mirror `completedAt` onto the chat doc

`convex/chatRuntime.ts`. Add one helper near `applyLifecycleVerdict` (`:429`):

```ts
// Mirror a terminal run outcome onto its chat so the sidebar can derive
// unread/error without scanning runs. Only completed/failed carry a sidebar
// signal (aborted/superseded is user-intent → idle), so this no-ops otherwise —
// which makes it safe to call from every settle site, hit or miss.
async function mirrorTerminalRunToChat(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  status: GenerationRunStatus,
  now: number
) {
  if (status !== "completed" && status !== "failed") return
  await ctx.db.patch(chatId, { lastRunEndedAt: now, lastRunStatus: status })
}
```

Call it right after each terminal run patch (three sites; `run`/`runId` and the
chat id are already in scope):

- `applyLifecycleVerdict`, after the `ctx.db.patch(run._id, …)` at `:452-459`
  (covers `fail`; abort/supersede no-op):
  ```ts
  await mirrorTerminalRunToChat(ctx, run.chatId, verdict.run.status, now)
  ```
- `markGenerationRunCompletedForChat`, after the patch at `:1563-1573`:
  ```ts
  await mirrorTerminalRunToChat(ctx, run.chatId, verdict.run.status, now)
  ```
- `resolveApprovalResponses`, after the patch at `:1181-1186` (`run` fetched at
  `:1169`):
  ```ts
  await mirrorTerminalRunToChat(ctx, run.chatId, verdict.run.status, now)
  ```

`GenerationRunStatus`, `MutationCtx`, `Id`, `Doc` are already imported in this
file. The `fail`-overwrites-`completed` race is harmless: whichever settles last
mirrors last, matching the run's final status.

### 2.3 Read-cursor query + mark-read mutation

`convex/sidebarStatus.ts` — append:

```ts
import { ownedChatMutation } from "./lib/authedFunctions"

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

// chatId is consumed + ownership-verified by the builder (injects ctx.chat/user).
export const markChatRead = ownedChatMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const existing = await ctx.db
      .query("chatReads")
      .withIndex("by_user_chat", (q) =>
        q.eq("userId", ctx.user._id).eq("chatId", ctx.chat._id)
      )
      .unique()
    if (existing) await ctx.db.patch(existing._id, { lastReadAt: now })
    else
      await ctx.db.insert("chatReads", {
        userId: ctx.user._id,
        chatId: ctx.chat._id,
        lastReadAt: now,
      })
  },
})
```

### 2.4 Surface the mirror fields on the client `Chat` type

`lib/chat-store/types.ts` — extend `Chat` (`:19`) and `convexChatToChat` (`:56`):

```ts
export type Chat = {
  // …existing…
  last_run_ended_at?: number | null
  last_run_status?: "completed" | "failed" | null
}

// in convexChatToChat(...):
  last_run_ended_at: convexChat.lastRunEndedAt ?? null,
  last_run_status: convexChat.lastRunStatus ?? null,
```

`lib/chat-store/chats/sidebar-window.ts` — same two lines in `mapConvexChat` (`:18`):

```ts
    last_run_ended_at: chat.lastRunEndedAt ?? null,
    last_run_status: chat.lastRunStatus ?? null,
```

(Optimistic/local chats simply leave these `undefined` → treated as "never ran".)

### 2.5 Wire unread/error into the hydration hook

`lib/chat-store/status/sidebar-chat-status.ts`, `useHydrateSidebarChatStatuses` —
replace the Phase-1 stubs:

```ts
  const { data: activeRuns } = usePerUserQuery(api.sidebarStatus.getActiveRunStatuses)
  const { data: readRows } = usePerUserQuery(api.sidebarStatus.getChatReads)
  const { chats: allChats } = useChats()

  const reads = React.useMemo(
    () => Object.fromEntries((readRows ?? []).map((r) => [r.chatId, r.lastReadAt])),
    [readRows]
  )
  // …effect deps: [activeRuns, readRows, allChats, activeChatId]
  const next = deriveSidebarStatuses({
    activeRuns: activeRuns ?? [],
    chats: allChats,
    reads,
    activeChatId,
  })
```

`useChats()` returns the full displayed union (`chats`) already carrying the mirror
fields — no extra subscription.

### 2.6 Mark-read on open and on active-chat completion

`lib/chat-store/status/sidebar-chat-status.ts` — add a small hook beside seam #1:

```ts
import { useMutation } from "convex/react"
import { isConvexId } from "@/lib/chat-store/types"

/**
 * Clear a chat's unread/error by stamping lastReadAt: on open (chat becomes
 * active) and again when the active chat's stream finishes (so opening mid-stream
 * and staying counts as read). No-op for guest/local/optimistic ids.
 */
export function useMarkChatReadOnView(chatId: string | null, status: string): void {
  const markChatRead = useMutation(api.sidebarStatus.markChatRead)
  const wasActiveRef = React.useRef(false)

  // On open / chat switch.
  React.useEffect(() => {
    if (!chatId || !isConvexId(chatId)) return
    void markChatRead({ chatId })
  }, [chatId, markChatRead])

  // On completion while viewing (streaming|submitted → ready).
  React.useEffect(() => {
    const active = status === "streaming" || status === "submitted"
    if (active) wasActiveRef.current = true
    else if (status === "ready" && wasActiveRef.current) {
      wasActiveRef.current = false
      if (chatId && isConvexId(chatId)) void markChatRead({ chatId })
    }
  }, [status, chatId, markChatRead])
}
```

`app/components/chat/chat.tsx`, beside `usePublishActiveChatStatus(chatId, status)`
(`:154`):

```ts
usePublishActiveChatStatus(chatId, status)
useMarkChatReadOnView(chatId, status) // NEW
```

### 2.7 Regenerate types + tests

```
bunx convex codegen
```

Tests (extend, keep lean):
- `convex/sidebarStatus.test.ts`: `markChatRead` inserts then patches (upsert);
  `getChatReads` returns the user's cursors only.
- `convex/chatRuntime.test.ts`: after `markGenerationRunCompleted`, the chat has
  `lastRunStatus: "completed"` + `lastRunEndedAt` set; after a failure, `"failed"`;
  after an abort, **unchanged** (no sidebar signal). One assertion each.
- `sidebar-chat-status.test.ts`: `deriveSidebarStatuses` — completed+unseen →
  `unread`; failed+unseen → `error`; completed+seen (`ended <= read`) → idle;
  aborted → idle; active run beats an unseen completion.

### Phase 2 acceptance
Two tabs, same account. Tab A on chat X; tab B starts a generation in chat Y, then
tab B navigates away before it finishes → Y shows the blue dot in **both** tabs.
Open Y in either tab → dot clears in both (reactive). Force a background failure →
red dot until opened. Open a chat mid-stream and stay → no dot after it finishes.
Guest session → no dots, no `markChatRead` calls (network tab shows none).

---

## Sequencing, risks, rollback

**Order:** 1.1 → 1.2 → 1.5 (codegen) → 1.3 → 1.4 → 1.6 → ship Phase 1. Then
2.1 → 2.7(codegen) → 2.2 → 2.3 → 2.7(codegen) → 2.4 → 2.5 → 2.6 → 2.7 tests →
ship Phase 2. (Codegen after every schema/function add so downstream edits
typecheck.)

**Risks & mitigations**
- *Double-write flicker on the active chat.* Mitigated structurally: the hook
  excludes `activeChatId`; seam #1 owns it. Verify the navigate-away handoff (row
  A keeps spinning after leaving A).
- *Chat-doc write amplification.* Completion now patches `chats` (a second patch
  per turn, after the turn-start `updatedAt` bump). Rows are memoized + read status
  from the store, so only changed rows re-render. If profiling ever shows churn,
  the fallback is the dedicated `by_user_ended` index + query (design doc §"Trade-offs").
- *Collapsed sidebar unmounts the hook.* `SidebarExpandedNav` unmount drops the
  subscription; the store keeps last values (rows in the icon rail read them). Add
  a `resetChatStatuses()` cleanup only if stale icons appear — otherwise leave it.
- *`markChatRead` write rate.* One upsert per chat-open. User-paced, fine. Optional
  later optimization: skip the call when the chat currently has no unread/error
  signal in the store.

**Rollback:** Phase 2 reverts cleanly to Phase 1 (drop 2.2–2.6; the schema
additions are optional/unused and can stay). Phase 1 reverts to seam-#1-only by
restoring the preview call (or mounting nothing). No data migration in either
direction — every schema change is additive.

**Follow-ups (not in scope):** approvals-index cross-check for `awaiting`;
error-dot TTL cap; `chatReads` pruning on chat delete (fold into `chats.remove`);
promoting this doc + the design doc to ADR-0011 once shipped.
