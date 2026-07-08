# Implementation plan: sidebar chat-status ← backend state

Companion to [`sidebar-status-backend-wiring.md`](./sidebar-status-backend-wiring.md).
Executable, file-by-file, as **one PR of ordered commits** (not independently
mergeable phases). Approach: **project status onto the `chats` doc** and derive each
row's indicator from the chat object it already subscribes to — no separate query,
no client store of backend statuses, no hydrator. Phase 1 lights up live status;
Phase 2 adds unread/error. Each commit leaves the branch green.

Grounding anchors (verified against current code):
- Store + seam #1: `lib/chat-store/status/sidebar-chat-status.ts` (seam #1 wired in
  `app/components/chat/chat.tsx:154`)
- Row consumers: `app/components/layout/sidebar/sidebar-item.tsx:24`,
  `app/components/layout/sidebar/project-chat-item.tsx:26`
- Chat type + mappers: `lib/chat-store/types.ts:19` (`Chat`), `:56`
  (`convexChatToChat`); `lib/chat-store/chats/sidebar-window.ts:18` (`mapConvexChat`)
- Run lifecycle write points: `convex/chatRuntime.ts` — run insert `:1292`,
  running→streaming + `chats.updatedAt` patch `:1373-1379`, snapshot patch `:1486`,
  awaiting `:1733`, completed `:1563`, `applyLifecycleVerdict` `:452`,
  `resolveApprovalResponses` `:1181`
- Lifecycle brain: `convex/domain/generation_run_lifecycle.ts` (`transition` vs
  `ignore` verdicts — the projection hooks only `transition`)

---

## Phase 1 — cross-chat live status

Outcome: every visible row (sidebar + project view) shows `streaming`/`awaiting`
from backend state, including background generations you navigated away from; the
active chat still lights instantly via seam #1.

### 1.1 Schema: status-projection fields on `chats`

`convex/schema.ts`, `chats` table. Land **all four** additive fields now (the
Phase-2 ones stay dormant until Phase 2 writes/reads them) so the projection helper
in 1.2 patches a schema that already knows every key:

```ts
    updatedAt: v.number(),
    // Live phase of the chat's current run; set at start/awaiting, cleared at
    // terminal. Projected by the generation lifecycle (1.2). — Phase 1
    liveRunStatus: v.optional(v.union(v.literal("streaming"), v.literal("awaiting"))),
    // Last *signaling* terminal outcome + owner-only read cursor. — Phase 2
    lastRunEndedAt: v.optional(v.number()),
    lastRunStatus: v.optional(v.union(v.literal("completed"), v.literal("failed"))),
    lastReadAt: v.optional(v.number()),
```

Expansion only — preflight-safe. `lastReadAt` is correct as a chat-doc field because
chats are single-owner (`chats.userId`): the only viewer with a sidebar row for a
chat is its owner.

### 1.2 Server: project run transitions onto the chat

`convex/chatRuntime.ts`. Add one helper near `applyLifecycleVerdict` (`:429`):

```ts
// Maps a run status → the chat-doc projection patch. Applied ONLY on a real
// lifecycle transition (never an "ignore" verdict), so a late terminal on an
// already-settled run writes nothing and can't clear a newer run's live status.
function chatStatusProjection(
  status: GenerationRunStatus,
  now: number
): Partial<Doc<"chats">> {
  switch (status) {
    case "running":
    case "streaming":
      return { liveRunStatus: "streaming" }
    case "awaiting_approval":
      return { liveRunStatus: "awaiting" }
    case "completed":
      return { liveRunStatus: undefined, lastRunEndedAt: now, lastRunStatus: "completed" } // Phase 2 fields
    case "failed":
      return { liveRunStatus: undefined, lastRunEndedAt: now, lastRunStatus: "failed" }
    case "aborted":
      return { liveRunStatus: undefined } // user Stop / supersede — no signal
  }
}
```

The `completed`/`failed` arms write the Phase-2 mirror keys, which is why 1.1 lands
all four fields — with them on the schema, this helper is written once and the
mirror simply stays dormant (no reader) until Phase 2. Patching `liveRunStatus:
undefined` removes the field (Convex `patch` semantics), which is the "clear."

Apply it at each transition site, where the chat id is in scope:

- **Run start** — `prepareGenerationForChat`, the running→streaming patch at
  `:1373-1379` already sets `chats.updatedAt`; add `liveRunStatus: "streaming"` to
  that same `ctx.db.patch(chat._id, …)`.
- **Awaiting** — `createToolApprovalRequestForChat` (`:1733`):
  `await ctx.db.patch(run.chatId, { liveRunStatus: "awaiting" })`.
- **Terminal** — after each real run patch, `applyLifecycleVerdict` (`:452`),
  `markGenerationRunCompletedForChat` (`:1563`), `resolveApprovalResponses`
  (`:1181`):
  ```ts
  await ctx.db.patch(run.chatId, chatStatusProjection(verdict.run.status, now))
  ```
  These handlers already run only on a `transition` verdict (they early-return on
  `ignore` via `isIgnoredSignal` / the verdict check), so the stale-clear is
  structurally impossible — see the design doc.

`GenerationRunStatus`, `Doc`, `Id` are already imported in this file.

### 1.3 Surface `live_run_status` on the client `Chat` type

`lib/chat-store/types.ts` — extend `Chat` (`:19`) and `convexChatToChat` (`:56`);
`lib/chat-store/chats/sidebar-window.ts` — same in `mapConvexChat` (`:18`):

```ts
// Chat type:
  live_run_status?: "streaming" | "awaiting" | null
// convexChatToChat / mapConvexChat:
  live_run_status: convexChat.liveRunStatus ?? null,
```

(Optimistic/local chats leave it `undefined` → `idle`.)

### 1.4 Store shrinks to `liveOverride`; derive from the chat; swap the public hook

`lib/chat-store/status/sidebar-chat-status.ts`. The store no longer holds backend
statuses — only the active-chat override. `useSidebarChatStatus` now takes the
`chat` (the row already has it) and derives.

```ts
export type LiveOverride = { chatId: string; status: SidebarChatStatus } | null
// store state: { liveOverride: LiveOverride, setLiveOverride(o) }  — drop `statuses`
// and its setters; the preview hook goes too (1.6).

const PRIORITY: Record<SidebarChatStatus, number> = {
  streaming: 3, awaiting: 3, error: 2, unread: 1, idle: 0,
}

export function deriveChatRowStatus(
  chat: {
    id: string
    live_run_status?: "streaming" | "awaiting" | null
    last_run_ended_at?: number | null // Phase 2
    last_run_status?: "completed" | "failed" | null // Phase 2
    last_read_at?: number | null // Phase 2
  },
  override: LiveOverride
): SidebarChatStatus {
  let s: SidebarChatStatus = "idle"
  if (chat.live_run_status === "streaming") s = "streaming"
  else if (chat.live_run_status === "awaiting") s = "awaiting"
  else if ((chat.last_run_ended_at ?? 0) > (chat.last_read_at ?? 0)) {
    if (chat.last_run_status === "failed") s = "error"
    else if (chat.last_run_status === "completed") s = "unread"
  }
  if (override && override.chatId === chat.id && override.status !== "idle" &&
      PRIORITY[override.status] > PRIORITY[s]) {
    s = override.status
  }
  return s
}

// PUBLIC CONTRACT CHANGE (justified): was `useSidebarChatStatus(chatId)` reading the
// store; now takes the chat the row already renders. In Phase 1 the last_run_*/
// last_read_at fields are absent → the unread/error branch is dead until Phase 2.
export function useSidebarChatStatus(chat: Chat): SidebarChatStatus {
  const override = useSidebarChatStatusStore((s) => s.liveOverride)
  return React.useMemo(() => deriveChatRowStatus(chat, override), [chat, override])
}
```

Seam #1 (`usePublishActiveChatStatus`) writes `liveOverride`
(`setLiveOverride({ chatId, activeChatStatusToSidebarStatus(status) })`, `null` on
unmount/no chat) — the same shape reached at the end of the prior review rounds. It
no longer touches any `statuses` map (there isn't one).

### 1.5 Update the two row consumers

`sidebar-item.tsx:24` and `project-chat-item.tsx:26`:

```ts
// was: const status = useSidebarChatStatus(chat.id)
const status = useSidebarChatStatus(chat)
```

Nothing else in the rows changes — `SidebarChatStatusIndicator` still takes a
status string. Because a row already subscribes to its `chat`, background updates
arrive with no extra wiring.

### 1.6 Retire the preview; codegen

- Delete `useSidebarChatStatusPreview` and the `previewChatIds` memo +
  `useSidebarChatStatusPreview(...)` call in `app-sidebar.tsx:302-307`, plus the
  `?sidebarStatusPreview` docblock — the real projection supersedes it.
- `bunx convex codegen` (or the running `convex dev`) so `chats.liveRunStatus`
  typechecks through the mappers.

### 1.7 Tests (Phase 1, lean)

- `convex/chatRuntime.test.ts`: after `prepareGeneration`, the chat has
  `liveRunStatus: "streaming"`; after `createToolApprovalRequest`, `"awaiting"`;
  after `markGenerationRunCompleted`, `liveRunStatus` is cleared.
- `lib/chat-store/status/sidebar-chat-status.test.ts` (new, pure): `deriveChatRowStatus`
  — `live_run_status` maps through; `override` raises but never lowers, and only for
  its own `chatId`; no fields → `idle`.

### Phase 1 acceptance
Start a generation in chat A, navigate to B: A's row spins (projection). **Return to
A before it finishes: A still spins** (projection beats the remounted-`ready`
override). A background tool-approval shows the amber dot. On a project page, a
project chat generating in the background spins too. Sign out: no indicators.
Sending in the active chat lights its spinner instantly (override), before the run
doc is visible.

---

## Phase 2 — unread / error

Outcome: a background generation that finishes while you're elsewhere leaves a blue
dot until you open the chat; a background failure leaves a red dot; opening (or
finishing while viewing) clears it — across tabs and devices.

### 2.1 Schema: already landed in 1.1

`lastRunEndedAt`, `lastRunStatus`, and `lastReadAt` were added to `chats` in 1.1
(dormant through Phase 1). Nothing to add here — Phase 2 just starts *reading* them.

**Rollout backfill (do this in the Phase 2 commit).** The mirror
(`lastRunEndedAt`) has been written since Phase 1, but `lastReadAt` is unset, so
every previously-completed chat would read as `unread` the moment Phase 2 surfaces
the fields. Ship a one-shot `internalMutation` that sets `lastReadAt = lastRunEndedAt`
(or `Date.now()`) for chats that have `lastRunEndedAt` and no `lastReadAt`, so only
completions *after* the Phase 2 deploy show a dot. (Moot if the deployment is
genuinely pre-launch with no data — but cheap insurance.)

### 2.2 Server: the terminal mirror is already written

`chatStatusProjection` (1.2) already sets `lastRunEndedAt`/`lastRunStatus` on the
`completed`/`failed` arms and writes nothing on `aborted` — and the fields exist from
1.1 — so the mirror is already landing; Phase 2 only starts *reading* it. Add
`markChatRead` to `convex/chats.ts`:

```ts
import { authenticatedMutation } from "./lib/authedFunctions"

// NOT ownedChatMutation: opening a *public* chat you don't own has a valid Convex id
// and ownedChatMutation would THROW. Unread only exists for chats you own → no-op.
export const markChatRead = authenticatedMutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const chat = await ctx.db.get(chatId)
    if (!chat || chat.userId !== ctx.user._id) return // public / not-owned → no-op
    await ctx.db.patch(chatId, { lastReadAt: Date.now() })
  },
})
```

### 2.3 Surface the fields; extend the derivation

`Chat` type + both mappers (`convexChatToChat`, `mapConvexChat`):

```ts
  last_run_ended_at?: number | null
  last_run_status?: "completed" | "failed" | null
  last_read_at?: number | null
// mappers:
  last_run_ended_at: c.lastRunEndedAt ?? null,
  last_run_status: c.lastRunStatus ?? null,
  last_read_at: c.lastReadAt ?? null,
```

`deriveChatRowStatus` (1.4) already reads these — its unread/error branch goes live
the moment the fields are populated. No hook change.

### 2.4 Mark-read on open + on backend completion (retry-safe)

`lib/chat-store/status/sidebar-chat-status.ts` — add beside seam #1:

```ts
import { useConvexAuth, useMutation } from "convex/react"
import { isConvexId } from "@/lib/chat-store/types"

/**
 * Clear a chat's unread/error by stamping lastReadAt: on open, and whenever the
 * ACTIVE chat's terminal mirror advances while viewing (covers a run that finished
 * locally *and* one you re-entered and watched). Backend-driven, independent of
 * useChat. Gated on Convex auth so it never fires into the auth-not-ready throw;
 * advances the tracking ref ONLY on success, so a transient failure can't suppress
 * the next attempt (review round 3, finding #2). No-op for guest/local/optimistic.
 */
export function useMarkChatReadOnView(
  chatId: string | null,
  lastRunEndedAt?: number | null
): void {
  const { isAuthenticated } = useConvexAuth()
  const markChatRead = useMutation(api.chats.markChatRead)
  const markedRef = React.useRef<{ chatId: string | null; endedAt: number }>({
    chatId: null,
    endedAt: 0,
  })

  React.useEffect(() => {
    if (!chatId || !isConvexId(chatId) || !isAuthenticated) return
    const ended = lastRunEndedAt ?? 0
    const prev = markedRef.current
    const switchedChat = prev.chatId !== chatId
    const runAdvanced = !switchedChat && ended > prev.endedAt
    if (!switchedChat && !runAdvanced) return
    markChatRead({ chatId })
      .then(() => {
        markedRef.current = { chatId, endedAt: ended } // advance only on success
      })
      .catch(() => {}) // best-effort; ref unchanged → later render / auth-ready retries
  }, [chatId, lastRunEndedAt, isAuthenticated, markChatRead])
}
```

`chat.tsx`, beside `usePublishActiveChatStatus(chatId, status)` (`:154`) — pass the
active chat's mirror timestamp from `useChat(chatId)` / `currentChat` (carries
`last_run_ended_at` after 2.3):

```ts
usePublishActiveChatStatus(chatId, status) // writes liveOverride
useMarkChatReadOnView(chatId, currentChat?.last_run_ended_at) // NEW
```

Gating on `isAuthenticated` is deliberate — the effect only fires once Convex auth
is ready, so opening a chat during the auth-sync window doesn't throw, and the ref
stays un-advanced until a mark actually succeeds.

### 2.5 Codegen + tests

- `bunx convex codegen`.
- `convex/chatRuntime.test.ts`: after `markGenerationRunCompleted`, the chat has
  `lastRunStatus: "completed"` + `lastRunEndedAt` set and `liveRunStatus` cleared;
  after a failure, `"failed"`; after an abort, the mirror is **unchanged** and only
  `liveRunStatus` is cleared.
- `convex/chats.test.ts`: `markChatRead` patches `lastReadAt` for an owned chat and
  **no-ops for a chat the caller doesn't own** (review #4).
- `sidebar-chat-status.test.ts`: `deriveChatRowStatus` — completed+unseen → `unread`;
  failed+unseen → `error`; seen (`ended <= read`) → `idle`; aborted (no mirror) →
  `idle`; live status beats an unseen completion.

### Phase 2 acceptance
Two tabs, same account. Tab A on chat X; tab B starts a generation in chat Y, then
navigates away before it finishes → Y shows the blue dot in **both** tabs. Open Y in
either tab → clears in both (reactive). Force a background failure → red dot until
opened. Open a chat mid-stream and stay → no dot after it finishes. Guest session →
no dots, no `markChatRead` calls (network tab shows none).

---

## Sequencing, risks, rollback

**Order:** 1.1 (all four fields) → 1.2 → 1.6 codegen → 1.3 → 1.4 → 1.5 → 1.7 → ship
Phase 1. Then 2.2 (`markChatRead`) → 2.5 codegen → 2.3 → 2.4 → 2.5 tests → ship
Phase 2. (Land all schema fields in 1.1 so the projection helper compiles once.)

**Risks & mitigations**
- *Projection drift (the one new risk).* `liveRunStatus` mirrors run state; a dropped
  "clear at terminal" write would strand a spinner. Small blast radius: the lifecycle's
  first-terminal-wins prevents late clears, the projection only fires on real
  transitions, and a stuck flag self-heals on the chat's next turn / supersede sweep.
  Symmetric with the terminal mirror (`lastRunEndedAt`) already in play.
- *Chat-doc write frequency.* Patched at turn start (already), awaiting (rare),
  terminal (already), and on open (`lastReadAt`). Streaming snapshots patch the
  run/message docs, NOT the chat doc → no per-750ms chat-list rerun. Rows are
  memoized on their chat, so only the changed row re-renders.
- *Public / non-owned chats (review #4).* `markChatRead` no-ops unless the caller
  owns the chat — opening a public chat must not throw.
- *Mark-read retry (review #2).* Gated on Convex auth; ref advances only on success,
  so a transient failure retries on the next open / run-advance / auth-ready.
- *Public contract change.* `useSidebarChatStatus(chat)` replaces
  `useSidebarChatStatus(chatId)` — two call sites (1.5) + the store's `statuses` map
  and preview hook are deleted. Grep for other callers before landing.
- *Delete-mid-generation (pre-existing, now orthogonal).* No `chatReads` to cascade;
  `lastReadAt` dies with the doc. The run/approval/snapshot orphan + the loud
  `finalize()` completion-write rejection (`durable-turn-runtime.ts:977`;
  `requireOwnedGenerationRun` throws once the run **or its chat** is gone,
  `auth.ts:131-135`) is a **separate** hardening: cascade-delete run state in
  `chats.remove` AND make terminal marks no-op when the target run **or its chat**
  was deleted by the owner (still throwing on auth/not-owner). Fast-follow; no data
  corruption today.

**Rollback:** Phase 2 reverts to Phase 1 by dropping `markChatRead` + the mark-read
hook + the unread/error mapper fields (the `deriveChatRowStatus` unread branch goes
dormant; schema fields are additive and can stay). Phase 1 reverts to seam-#1-only
by restoring `useSidebarChatStatus(chatId)` + the store `statuses` map + the preview.
No data migration either direction — every schema change is additive.

**Follow-ups (separate):** delete-mid-generation hardening (above); approvals-index
cross-check for `awaiting`; error-dot TTL cap; promoting this + the design doc to
ADR-0011 once shipped.
