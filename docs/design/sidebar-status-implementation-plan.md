# Implementation plan: sidebar chat-status ← backend state

Companion to [`sidebar-status-backend-wiring.md`](./sidebar-status-backend-wiring.md).
Executable, file-by-file. Approach: **project status onto the `chats` doc** and
derive each row's indicator from the chat object it already subscribes to — no
separate query, no client store of backend statuses, no hydrator.

## Delivery: one PR, five ordered commits

Ship this as **a single pull request of five ordered commits**, not multiple PRs.
Each commit leaves the branch green (compiles + tests pass) and is independently
reviewable; the "Phase" labels are just a logical grouping inside the one PR.

| # | Commit | Steps | Green because |
| --- | --- | --- | --- |
| 1 | `schema: chat status-projection fields` | 1.1 + codegen | five additive `chats` fields; nothing writes or reads them yet |
| 2 | `server: project run status onto chat + strip public reads` | 1.2, 1.6 | lifecycle writes the fields and public reads strip them; no client surface yet |
| 3 | `client: live sidebar status from the chat doc` | 1.3, 1.4, 1.5, 1.7, 1.8 | rows render `streaming`/`awaiting` from the doc; preview retired; tests pass |
| 4 | `server: markChatRead mutation` | 2.2 + codegen | mutation exists, unused by the client |
| 5 | `client: unread/error + mark-read` | 2.3, 2.4, 2.5 | unread/error derive and clear on view |

Commits 1–3 are Phase 1 (live status); 4–5 are Phase 2 (unread/error). All five
land in the same PR and deploy together. Commit 3 is the only natural seam if the
PR ever *had* to be split — but the intent is one PR. Because commits 2 and 5
deploy atomically, the "mass-unread on a separate Phase-2 deploy" problem does not
arise, so **no backfill is needed** (see 2.1).

Grounding anchors (verified against current `chatRuntime.ts` unless noted):
- Store + seam #1: `lib/chat-store/status/sidebar-chat-status.ts` (seam #1 wired in
  `app/components/chat/chat.tsx:154`)
- Row consumers: `app/components/layout/sidebar/sidebar-item.tsx:24`,
  `app/components/layout/sidebar/project-chat-item.tsx:26` (both call
  `useSidebarChatStatus(chat.id)` today — the only two callers of the store's API)
- Chat type + mappers: `lib/chat-store/types.ts:19` (`Chat`), `:56`
  (`convexChatToChat`); `lib/chat-store/chats/sidebar-window.ts:18` (`mapConvexChat`)
- Run lifecycle: run-start patch `chatRuntime.ts:1379` (`ctx.db.patch(args.chatId,…)`);
  the terminal/verdict choke point `applyLifecycleVerdict` at `:429` (patches the run
  at `:452`); snapshot patch `:1486` (run/message docs, not `chats`). Older per-site
  line numbers were stale — re-derive at implementation (1.2).
- Lifecycle brain: `convex/domain/generation_run_lifecycle.ts` (`fail` may overwrite
  `completed` — `:187` — which is *why* the run-id guard is required, 1.2).

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
    // Run that owns the chat's status slot — the run-scoped guard (1.2). — Phase 1
    statusRunId: v.optional(v.id("generationRuns")),
    // Last *signaling* terminal outcome + read cursor. — Phase 2
    lastRunEndedAt: v.optional(v.number()),
    lastRunStatus: v.optional(v.union(v.literal("completed"), v.literal("failed"))),
    lastReadAt: v.optional(v.number()),
```

Expansion only — preflight-safe. Chats are single-owner (`chats.userId`), so a
per-doc `lastReadAt` is semantically fine — **but** these five fields ride a doc that
public reads return, so they must be stripped from non-owner reads (step 1.6). "On
the doc" ≠ "private."

### 1.2 Server: project run transitions onto the chat

`convex/chatRuntime.ts`. Add one helper near `applyLifecycleVerdict` (`:429`):

```ts
function chatStatusProjection(status: GenerationRunStatus, now: number): Partial<Doc<"chats">> {
  switch (status) {
    case "running":
    case "streaming":         return { liveRunStatus: "streaming" }
    case "awaiting_approval": return { liveRunStatus: "awaiting" }
    case "completed":         return { liveRunStatus: undefined, lastRunEndedAt: now, lastRunStatus: "completed" } // Phase 2 fields
    case "failed":            return { liveRunStatus: undefined, lastRunEndedAt: now, lastRunStatus: "failed" }
    case "aborted":           return { liveRunStatus: undefined } // user Stop / supersede — no signal
  }
}

// Run-scoped guard: only the run that OWNS the chat's status slot (statusRunId) may
// project. statusRunId is kept after terminal, so a same-run completed→failed still
// applies; an OLDER run's late terminal is a no-op.
async function projectRunStatusToChat(
  ctx: MutationCtx, run: Doc<"generationRuns">, status: GenerationRunStatus, now: number
) {
  const chat = await ctx.db.get(run.chatId)
  if (!chat || chat.statusRunId !== run._id) return // a newer run owns the row → skip
  await ctx.db.patch(run.chatId, chatStatusProjection(status, now))
}
```

The `completed`/`failed` arms write the Phase-2 mirror keys, which is why 1.1 lands
all fields — the helper is written once and the mirror stays dormant (no reader)
until Phase 2. Patching `liveRunStatus: undefined` removes the field (Convex `patch`
semantics), which is the "clear."

Hook points (line numbers verified against current `chatRuntime.ts`):

- **Run start (claim the slot)** — `prepareGenerationForChat` already patches
  `args.chatId` at `:1379` (`ctx.db.patch(args.chatId, { updatedAt: now })`). Extend
  it to `{ updatedAt: now, liveRunStatus: "streaming", statusRunId: runId }`. No
  guard — claiming is the point. (This running→streaming patch is a direct write, not
  a verdict, so it isn't covered by the choke point below.)
- **Every verdict transition (awaiting/completed/failed/aborted/superseded)** —
  `applyLifecycleVerdict(ctx, run, verdict, …)` at `:429` is the **single choke
  point**: it patches `run._id` with `verdict.run.status` at `:452`. Add, right after
  that patch, `await projectRunStatusToChat(ctx, run, verdict.run.status, now)`. One
  hook covers all terminal transitions and the awaiting downgrade — no per-site list
  to keep in sync.
- **Verify at implementation:** confirm the tool-approval *request* path
  (`createToolApprovalRequestForChat`, ~`:1669`) reaches `awaiting_approval` through
  `applyLifecycleVerdict`; if it patches the run directly instead, add the projection
  call there too. (The prior draft listed several now-stale line numbers — re-derive,
  don't trust them.)

**The run-id guard is required — an earlier draft wrongly claimed the guard was
unnecessary ("only transition verdicts, so stale clears are impossible").** It is
not: the lifecycle deliberately lets `fail` overwrite `completed`
(`generation_run_lifecycle.ts:187`; test `chatRuntime.test.ts:2453`). Race: run A
completes → user starts run B (B claims the slot, projects `streaming`) → A's late
`fail` is a real `transition` and, unguarded, would patch `{ liveRunStatus:
undefined, lastRunStatus: "failed" }`, clearing B's spinner and showing A's stale
failure. The `statusRunId` guard makes A's projection a no-op. Convex mutations are
transactional, so read-guard-then-patch is race-free.

`GenerationRunStatus`, `Doc`, `Id`, `MutationCtx` are already imported in this file.

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

// A non-idle active-tab override WINS (not raise-only): it is authoritative for the
// tab issuing the request, so a local `error` shows even while the backend still
// projects `streaming` (best-effort terminal writes can lag). A local idle/ready
// override never lowers the backend, so a re-entered background run keeps spinning.
export function deriveChatRowStatus(
  chat: {
    live_run_status?: "streaming" | "awaiting" | null
    last_run_ended_at?: number | null // Phase 2
    last_run_status?: "completed" | "failed" | null // Phase 2
    last_read_at?: number | null // Phase 2
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

// PUBLIC CONTRACT CHANGE (justified): was `useSidebarChatStatus(chatId)` reading a
// store map; now takes the chat the row already renders. The selector returns only
// THIS row's override slice, so a liveOverride change re-renders only the targeted
// row (rows aren't React.memo'd — see risks). Phase 1: last_run_*/last_read_at are
// absent → the unread/error branch is dead until Phase 2.
export function useSidebarChatStatus(chat: Chat): SidebarChatStatus {
  const overrideStatus = useSidebarChatStatusStore((s) =>
    s.liveOverride?.chatId === chat.id ? s.liveOverride.status : null
  )
  return deriveChatRowStatus(chat, overrideStatus)
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

### 1.6 Strip owner-only fields from public reads

The projection fields ride the chat doc, and public reads return the whole doc
(`getAuthorizedChatForRead` returns `public` chats without owner filtering,
`auth.ts:83`). Strip them for non-owners so a shared-chat viewer never receives the
owner's `lastReadAt`/live state (nor reactive updates to it).

`convex/chats.ts`:

```ts
const OWNER_ONLY = ["liveRunStatus", "statusRunId", "lastRunEndedAt", "lastRunStatus", "lastReadAt"] as const
function stripOwnerStatus(chat: Doc<"chats">) {
  const c = { ...chat }; for (const k of OWNER_ONLY) delete (c as Record<string, unknown>)[k]; return c
}
// getById (readableChatQuery — has ctx.chat + ctx.user):
//   return ctx.chat && ctx.user && ctx.chat.userId === ctx.user._id ? ctx.chat : ctx.chat && stripOwnerStatus(ctx.chat)
// getPublicById (pure public — no owner): return chat && stripOwnerStatus(chat)
```

Owner-scoped list queries (`getForCurrentUser`, `getRecentWindowForCurrentUser`,
`getPinnedForCurrentUser`, `getProjectChatsForCurrentUser`) only return the caller's
own chats, so they need no stripping. This is part of **commit 2** — `liveRunStatus`
/ `statusRunId` are written from commit 2, so they must be stripped from that commit on.

### 1.7 Retire the preview; codegen

- Delete `useSidebarChatStatusPreview` and the `previewChatIds` memo +
  `useSidebarChatStatusPreview(...)` call in `app-sidebar.tsx:302-307`, plus the
  `?sidebarStatusPreview` docblock — the real projection supersedes it.
- `bunx convex codegen` (or the running `convex dev`) so the new fields typecheck.

### 1.8 Tests (Phase 1, lean)

- `convex/chatRuntime.test.ts`: after `prepareGeneration`, the chat has
  `liveRunStatus: "streaming"` + `statusRunId`; after `createToolApprovalRequest`,
  `"awaiting"`; after `markGenerationRunCompleted`, `liveRunStatus` is cleared.
  **Run-id guard:** complete run A, start run B (B claims the slot), then apply A's
  `fail` → the chat still shows B's `streaming` (A's projection is a no-op).
- `convex/chats.test.ts`: `getById` on a public chat as a **non-owner** omits the
  five owner-only fields; as the owner, returns them.
- `lib/chat-store/status/sidebar-chat-status.test.ts` (new, pure): `deriveChatRowStatus`
  — `live_run_status` maps through; a **non-idle override wins** (local `error` beats
  backend `streaming`); a local `idle` override does NOT lower backend `streaming`;
  no fields → `idle`.

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

**No backfill needed in the one-PR delivery.** The mirror (`lastRunEndedAt`) and its
reader (commit 5) ship in the same PR and deploy atomically, so there is no window
where `lastRunEndedAt` accumulates in production before `lastReadAt` exists — at
deploy, no chat has `lastRunEndedAt` yet (it's a brand-new field). Only completions
*after* deploy set it, and those correctly show a dot until opened. A one-shot
`internalMutation` setting `lastReadAt = lastRunEndedAt` for chats missing the cursor
is needed **only if** commits 1–3 are ever shipped to production ahead of 4–5 (the
split this PR deliberately avoids).

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
 * useChat. Gated on Convex auth to skip the common not-authenticated throw; a rarer
 * "user not found" during WorkOS→Convex user-row sync is still possible and is
 * caught. The ref advances ONLY on success, so any failure retries on the next
 * open / run-advance / auth-ready render. No-op for guest/local/optimistic.
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

Gating on `isAuthenticated` skips the common not-authenticated throw; a rarer "user
not found" during user-row sync can still reject, which the `.catch` absorbs. Either
way the ref stays un-advanced until a mark actually succeeds, so the next
open/advance/auth-ready render retries.

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

**Order (one PR, five commits — see the Commit plan at the top):**
- **Commit 1** — 1.1 (all five `chats` fields) → codegen.
- **Commit 2** — 1.2 (projection helper + hooks) + 1.6 (public-read strip).
- **Commit 3** — 1.3 → 1.4 → 1.5 → 1.7 (retire preview) → 1.8 (tests).
- **Commit 4** — 2.2 (`markChatRead`) → codegen.
- **Commit 5** — 2.3 → 2.4 → 2.5 (tests).

Run `bunx convex codegen` at the end of any commit that changed `convex/schema.ts`
or added a function (commits 1 and 4) so the next commit typechecks. Each commit
compiles and passes tests on its own; the whole PR merges together.

**Risks & mitigations**
- *Older-run clobber (review round 4, #1).* The run-id guard (`statusRunId`) is
  load-bearing: without it, a completed run's late `fail` overwrites a newer run's
  live row (the lifecycle allows `fail` over `completed`). The guard has a unit test
  (1.8); don't remove it.
- *Projection drift.* Even with the guard, a *dropped* "clear at terminal" write for
  the owning run would strand a spinner. Small blast radius: it self-heals on the
  chat's next turn / supersede sweep, and it's symmetric with the terminal mirror
  (`lastRunEndedAt`) already in play.
- *Chat-doc write frequency.* Patched at turn start (already), awaiting (rare),
  terminal (already), and on open (`lastReadAt`). Streaming snapshots patch the
  run/message docs, NOT the chat doc → no per-750ms chat-list rerun. Accurate on
  re-renders: rows are **not** `React.memo`'d, so a chat-list change re-renders the
  list (cheap for a bounded window); a `liveOverride` change is row-scoped (selector
  returns only the row's slice). Add `React.memo` only if a large window profiles hot.
- *Public read exposure (review #2).* The five projection fields are stripped from
  non-owner `getById`/`getPublicById` (1.6); owner-scoped list queries need no strip.
- *Public / non-owned chats (review #4).* `markChatRead` no-ops unless the caller
  owns the chat — opening a public chat must not throw.
- *Mark-read retry (review #2).* Gated on Convex auth; ref advances only on success,
  so a transient failure retries on the next open / run-advance / auth-ready.
- *Public contract change.* `useSidebarChatStatus(chat)` replaces
  `useSidebarChatStatus(chatId)`. Verified: `sidebar-item.tsx` and
  `project-chat-item.tsx` are the **only** callers of the store's public API (no
  other references to `useSidebarChatStatus`/`setChatStatus`/`clearChatStatus`/
  `resetChatStatuses`), so this and the `statuses`-map removal are a two-file change.
- *Delete-mid-generation (pre-existing, now orthogonal).* No `chatReads` to cascade;
  `lastReadAt` dies with the doc. The run/approval/snapshot orphan + the loud
  `finalize()` completion-write rejection (`durable-turn-runtime.ts:977`;
  `requireOwnedGenerationRun` throws once the run **or its chat** is gone,
  `auth.ts:131-135`) is a **separate** hardening: cascade-delete run state in
  `chats.remove` AND make terminal marks no-op when the target run **or its chat**
  was deleted by the owner (still throwing on auth/not-owner). Fast-follow; no data
  corruption today.

**Rollback:** since it's one PR, the simplest rollback is `git revert` of the merge.
For a partial back-out, the commits peel cleanly in reverse: reverting commit 5 (then
4) drops unread/error and leaves live status working; reverting commit 3 returns to
seam-#1-only. Commits 1–2 (schema fields + dormant server writes) are additive and
harmless to leave. No data migration in either direction.

**Follow-ups (separate):** delete-mid-generation hardening (above); approvals-index
cross-check for `awaiting`; error-dot TTL cap; promoting this + the design doc to
ADR-0011 once shipped.
