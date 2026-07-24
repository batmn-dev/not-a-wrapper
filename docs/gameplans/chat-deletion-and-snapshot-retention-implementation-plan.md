# Implementation Plan: Snapshot Retention Repair + Asynchronous Chat/Project Deletion

- **Status:** Ready to implement
- **Date:** 2026-07-23
- **Inputs:** `docs/convex-chat-deletion-failure-analysis.md` (Option D) + the independent
  review that approved it with required revisions (write-storm guard, exact tombstone
  surface inventory, legacy-purge ordering rule, one-paginate-per-function constraint).
- **Branch:** work on the **current branch** (`darknight/justice-buster`). Do NOT create
  a new branch. Three commits (Checkpoints 1–3), then one PR to `main`.
- **Incident being fixed:** `chats:remove` fails with
  `Too many bytes read in a single function execution (limit: 16777216 bytes)` at
  `convex/domain/chat_owned_deletion.ts:86/:117` because the mutation reads the complete
  owned graph before deleting. Live-verified: one chat's `assistantMessageSnapshots`
  range alone exceeds 16 MiB; another holds 13.5 MB of snapshots against 2 messages.
  A historical persist storm (~59 ms cadence, frozen content) produced runs with
  860–2,651 snapshot rows.

---

## 0. Ground rules (read before touching anything)

1. **Never modify these behaviors.** They are load-bearing and verified:
   - The unconditional final full-parts flush before terminal settlement
     (`flushFinal`, `app/api/chat/durable-turn-runtime.ts:650-662`, ADR-0011).
   - The stale-sequence pre-insert rejection in `updateAssistantSnapshotForChat`
     (`convex/chatRuntime.ts:1650-1653`).
   - The `lastSnapshotSequence` patch on **both** branches of
     `updateAssistantSnapshotForChat` (`convex/chatRuntime.ts:1687-1701`) — the
     terminal-message `else` branch exists so late stale writes still reject; keep it.
   - The empty-placeholder terminal policy in
     `convex/domain/generation_run_lifecycle.ts:141-159`.
   - Grant rejection codes/messages in `convex/chatRuntimeWorker.ts:56-84` — the HTTP
     action maps them to 401 by code; reuse `grant_unauthorized`, never invent a new code.
2. **Convex platform constraints** (installed `convex@1.42.1`):
   - 16 MiB read / 16 MiB written / 32,000 docs scanned / 16,000 docs written /
     4,096 index ranges per mutation. Helpers do NOT get a fresh budget — only a newly
     scheduled mutation does.
   - **At most ONE `.paginate()` call per function execution.** Every cleanup mutation
     drains exactly one table with exactly one paginated read. (The test fake at
     `convex/domain/chat_owned_deletion.test.ts:180-184` enforces this — keep that fake
     behavior in the new harness.)
   - Scheduling from a mutation is atomic with its commit; scheduled mutations run
     exactly once; Convex retries internal errors only; auth is NOT propagated to
     scheduled functions.
3. **Schema policy:** pre-launch rules apply (`AGENTS.md` "Pre-Launch"). Add fields
   directly as `v.optional(...)`. Do NOT remove the `assistantMessageSnapshots` table or
   its legacy fields (`format`/`delta`/`payload`) in this PR — contraction is a
   follow-up after the purge.
4. **Package manager:** `bun`. Verification loop for every checkpoint:
   ```bash
   bun run typecheck && bun run lint && bun run test
   ```
5. **File deletions in Checkpoint 3** (`chat_owned_deletion.ts` + its test) are
   pre-approved by this plan.
6. Match surrounding comment style: comments state constraints/invariants, not
   narration of the next line.

---

## Checkpoint 1 (Commit 1) — Snapshot lifecycle repair

**Goal:** stop retaining routine snapshot rows, replace the only historical-row read
with the run-level invariant, and add the write-storm acceptance guard. After this
commit, new runs create **zero** `assistantMessageSnapshots` rows while keeping every
recovery semantic intact.

### 1.1 Replace the regeneration existence probe — `convex/chatRuntime.ts:465-473`

Current code (inside `gatherAssistantMessageFacts`):

```ts
const hasSnapshotForRun = isReusedForRegeneration
  ? (await ctx.db
      .query("assistantMessageSnapshots")
      .withIndex("by_run_sequence", (q) => q.eq("runId", run._id))
      .first()) !== null
  : false
```

Replace with a run-field read plus a legacy fallback (production may contain runs that
predate `lastSnapshotSequence`):

```ts
// Projected-output invariant: `lastSnapshotSequence` is patched in the same
// mutation as every accepted checkpoint (both branches of
// updateAssistantSnapshotForChat) and sequences start at 1, so `> 0` is
// equivalent to "at least one accepted checkpoint for this run". Legacy runs
// written before the field existed fall back to the row probe; that fallback
// (and the rows it reads) may be removed only after the legacy purge.
const hasSnapshotForRun = isReusedForRegeneration
  ? run.lastSnapshotSequence !== undefined
    ? run.lastSnapshotSequence > 0
    : (await ctx.db
        .query("assistantMessageSnapshots")
        .withIndex("by_run_sequence", (q) => q.eq("runId", run._id))
        .first()) !== null
  : false
```

Do NOT rename `hasSnapshotForRun` (it threads through
`generation_run_lifecycle.ts` facts). Do NOT touch the two constant-`false` sites
(`convex/chatRuntime.ts:489` and `:733`).

### 1.2 Stop inserting routine rows + add the acceptance guard — `convex/chatRuntime.ts:1621-1703`

Rewrite the body of `updateAssistantSnapshotForChat` in this exact order:

1. Keep: `requireAssistantMessageForRun`, the terminal gate (`kind: "lost"`), the stale
   gate (`kind: "stale"`).
2. **Acceptance guard (new, before any write).** The message doc is already loaded;
   compare content:

   ```ts
   // Write-storm guard: a checkpoint whose content is byte-identical to what the
   // message already carries advances the sequence but must not rewrite the
   // (potentially large) message doc. Historical storms wrote identical
   // ~7 KB checkpoints at ~59 ms cadence for minutes; the sequence guard cannot
   // reject them because sequences advance.
   const contentUnchanged =
     message.content === args.textSnapshot &&
     JSON.stringify(message.parts) === JSON.stringify(args.partsSnapshot)
   ```

3. **Delete the `ctx.db.insert("assistantMessageSnapshots", ...)` block**
   (`convex/chatRuntime.ts:1655-1669`) behind a rollback seam:

   ```ts
   // Rollback seam (delete after one green production cycle): setting
   // RETAIN_ROUTINE_SNAPSHOT_ROWS=1 in the Convex deployment env restores
   // historical row retention without any other behavior change.
   if (process.env.RETAIN_ROUTINE_SNAPSHOT_ROWS === "1") {
     await ctx.db.insert("assistantMessageSnapshots", { /* existing literal */ })
   }
   ```

4. Keep both existing patch branches exactly as they are, with one change: in the
   non-terminal branch, skip the **message** patch when `contentUnchanged` (still patch
   the run — `lastSnapshotSequence`/`lastProgressAt`/`status` must advance).
   The terminal-message `else` branch (`:1697-1701`) stays untouched.
5. Return shape unchanged (`{ kind: "applied" }`); add `deduped: contentUnchanged`.
   **Wire shape caveat:** the worker HTTP endpoint wraps every mutation result as
   `{ ok: true, result }` (`convex/http.ts:100-104`), and `workerWrite` resolves with
   that wrapper as `unknown`. Callers unwrap `.result` with a narrow local cast — the
   established pattern is the heartbeat at
   `app/api/chat/durable-turn-runtime.ts:1103-1104`. Do NOT change the wire contract
   to unwrap globally (heartbeat and both snapshot-guard rejection paths branch on the
   wrapper). In the persist callback's success handler (`:1313-1316`), mirror the
   heartbeat pattern:

   ```ts
   const result = (written as { result?: { deduped?: boolean } })?.result
   perfSession?.counter(result?.deduped ? "deduped" : "accepted")
   ```

   A sustained deduped-to-accepted ratio near 1 is the storm detector — the metric
   that proves (or disproves) that the historical ~59 ms write storms are gone.

**Do not** change `generationRunWriteArgs.updateAssistantSnapshot` (the `delta`/`payload`
optional args stay for wire compatibility; they are simply never persisted once the
insert is gated off).

### 1.3 Legacy purge mutation (manual-run, bounded) — new file `convex/deletionCleanup.ts` (started here, extended in Checkpoint 3)

Add one internal mutation:

```ts
export const purgeLegacySnapshotRows = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => { ... },
})
```

Behavior (one paginated read, this function's only one):

- `ctx.db.query("assistantMessageSnapshots").paginate({ cursor: cursor ?? null, numItems: 200, maximumRowsRead: 400, maximumBytesRead: 2 * 1024 * 1024 })`
- For each row, `ctx.db.get(row.runId)`. **Delete the row ONLY if the run is missing or
  its status is terminal** (`isTerminalGenerationRunStatus`). Rows of live runs are
  skipped — while the legacy fallback probe from §1.1 exists, purging a non-terminal
  run's rows could later mis-settle a reused regeneration as `restore-completed`.
- If `!isDone`, `ctx.scheduler.runAfter(0, internal.deletionCleanup.purgeLegacySnapshotRows, { cursor: continueCursor })`.
  (A cursor is safe here because skipped rows remain — this is a filtered sweep, not a
  destructive drain of its own range prefix.)
- Log content-free progress only: counts and byte totals via `getConvexSize`.

Kick it manually when ready: `bunx convex run deletionCleanup:purgeLegacySnapshotRows '{}'`.
Do NOT wire it to a cron.

### 1.4 Tests (update in place — keep the suite lean)

- `convex/chatRuntime.test.ts`: existing snapshot assertions reference inserted rows
  (around lines 32, 89, 426, 2067) and `lastSnapshotSequence` (around 3764-3866).
  Update expectations: accepted checkpoints insert **no** rows; message+run patches
  unchanged. Add exactly three new cases:
  1. Reused regeneration with `lastSnapshotSequence: 3` on the run and zero rows →
     terminal failure keeps the partial answer (stamp), does NOT restore.
  2. Legacy run (`lastSnapshotSequence: undefined`) with one snapshot row → probe
     fallback still fires (assert via the same outcome).
  3. Storm guard: two consecutive `updateAssistantSnapshot` calls with identical
     text/parts and ascending sequences → second call patches the run but not the
     message (assert message `updatedAt` unchanged, run `lastSnapshotSequence` advanced).
- Do not add new test files in this checkpoint.

### 1.5 Verify and commit

```bash
bun run typecheck && bun run lint && bun run test
```

Manual smoke (against dev): stream one durable turn, confirm in the dashboard that no
new `assistantMessageSnapshots` rows appear and the assistant message still fills in
live; reload mid-stream — content survives.

**Commit 1 message:**

```
Snapshot lifecycle: run-level invariant, zero routine retention, storm guard

- Replace the regeneration row-existence probe with lastSnapshotSequence > 0
  (legacy-run fallback retained until purge completes)
- Gate routine assistantMessageSnapshots inserts behind
  RETAIN_ROUTINE_SNAPSHOT_ROWS (default off)
- Skip message-doc rewrites for content-identical checkpoints (write-storm guard)
- Bounded manual purge for legacy rows of terminal runs
```

---

## Checkpoint 2 (Commit 2) — Tombstones and immediate denial (no behavior change yet)

**Goal:** add deletion state to the schema and enforce "a deleting root is invisible and
write-dead" across EVERY surface. Nothing writes a tombstone yet, so this commit is
deploy-safe and behavior-neutral; it must be complete before Checkpoint 3 flips
`remove` over.

### 2.1 Schema — `convex/schema.ts`

- `chats` table (after `liveRunFreshUntil`, `~:101`):
  ```ts
  // Deletion tombstone (logical deletion is immediate; physical cleanup is a
  // scheduled drain — see deletionJobs). A set value makes the chat invisible
  // and write-dead on every surface. Never cleared once set.
  deletingAt: v.optional(v.number()),
  ```
- `projects` table (`~:326-336`): same `deletingAt: v.optional(v.number())`.
- New table (place after `projects`):
  ```ts
  deletionJobs: defineTable({
    targetKind: v.union(v.literal("chat"), v.literal("project")),
    chatId: v.optional(v.id("chats")),      // chat target, or project job's current chat
    projectId: v.optional(v.id("projects")),
    userId: v.id("users"),                   // owner at initiation; internal consistency only
    state: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("blocked"),
      v.literal("complete")
    ),
    phase: v.string(),                        // one of DELETION_PHASES / PROJECT_PHASES
    version: v.number(),                      // job format version, start at 1
    batchesProcessed: v.number(),
    documentsDeleted: v.number(),
    bytesObserved: v.number(),                // getConvexSize of deleted rows, content-free
    retryCount: v.number(),
    failureCode: v.optional(v.string()),      // stable enum string, never content
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_chat", ["chatId"])
    .index("by_project", ["projectId"])
    .index("by_state_updated", ["state", "updatedAt"]),
  ```
  Never store message content, snapshot payloads, tool payloads, titles, grants, or
  digests in a job row.

### 2.2 Central guards — `convex/lib/auth.ts`

Add at the top of the helper section:

```ts
/** A chat is active when neither it nor its linked project is being deleted.
 * The project read is required so tombstoning a project instantly revokes
 * every linked chat without patching children. Fail closed on a dangling
 * projectId (same policy as chat_project_link). */
export function isChatDocActive(chat: Doc<"chats">): boolean {
  return chat.deletingAt === undefined
}

export async function isChatActive(
  ctx: ConvexCtx,
  chat: Doc<"chats">
): Promise<boolean> {
  if (chat.deletingAt !== undefined) return false
  if (!chat.projectId) return true
  const project = await ctx.db.get(chat.projectId)
  return project !== null && project.deletingAt === undefined
}
```

Then wire it (each edit is 1–3 lines; keep existing error messages so callers can't
distinguish "deleting" from "missing" — deletion must look like absence):

| Helper | Edit |
|---|---|
| `getAuthorizedChatForRead` (`auth.ts:77-89`) | after `if (!chat) return null`: `if (!(await isChatActive(ctx, chat))) return null` |
| `requireOwnedChat` (`auth.ts:91-104`) | after the ownership check: `if (!(await isChatActive(ctx, chat))) throw new Error("Chat not found")` |
| `requireOwnedGenerationRun` (`auth.ts:125-138`) | after the chat ownership line: `if (!(await isChatActive(ctx, chat))) throw new Error("Run not found")` |
| `requireOwnedProject` (`auth.ts:140-156`) | after resolution: `if (project.deletingAt !== undefined) throw new Error("Project not found")` |

This automatically covers every builder in `convex/lib/authedFunctions.ts`
(`readableChatQuery`, `ownedChatQuery/Mutation`, `ownedGenerationRunMutation`,
`ownedProjectQuery/Mutation`) and therefore `chats.remove`, `prepareGeneration`
(`chatRuntime.ts:1343` uses `requireOwnedChat`), `messages.add/addBatch/selectBranch`,
`files.attachStagedFiles`, `files.getTrustedTextAttachmentsForChat`, etc.

### 2.3 Worker grant revocation — `convex/chatRuntimeWorker.ts:90-114`

In `requireGrantAuthorizedRun`, after the chat/user ownership check (`:106-111`):

```ts
// Root tombstone revokes every outstanding grant without scanning runs. OCC
// orders the race: if deletion commits first, this read sees the marker and
// rejects; if the worker write commits first, the deletion mutation retries.
if (chat.deletingAt !== undefined) throw grantRejection("grant_unauthorized")
if (chat.projectId) {
  const project = await ctx.db.get(chat.projectId)
  if (!project || project.deletingAt !== undefined) {
    throw grantRejection("grant_unauthorized")
  }
}
```

Nothing else in this file changes. The durable runtime already absorbs
`grant_unauthorized` as authority-lost (`durable-turn-runtime.ts:1317-1329`), so
deletion mid-stream lands on an existing tested path.

### 2.4 Bypass surfaces (each MUST be edited by hand — they do not use the central helpers)

| Surface | File:line | Edit |
|---|---|---|
| `chats.getPublicById` | `convex/chats.ts:465` | after resolving + `public` check: return `null` when `chat.deletingAt !== undefined` (skip the project read here — public chats are never project-linked in practice, but add `await isChatActive` if trivial) |
| `chats.markChatRead` | `convex/chats.ts:484-511` | no-op (return early) when `chat.deletingAt !== undefined` |
| `messages.getPublicForChat` | `convex/messages.ts:124-137` (handler) | return `[]` when chat missing, not public, or `deletingAt !== undefined` |
| `projects.getById` | `convex/projects.ts:40-55` | return `null` when `project.deletingAt !== undefined` |
| `projects.getByIdWithOwner` | `convex/projects.ts:57` | return `null` when `project.deletingAt !== undefined` (internal, but callers must not resurrect) |
| `toolCallLog.log` | `convex/toolCallLog.ts:25` (inline chat check) | treat a deleting chat exactly like a foreign chat (reject/skip with the existing error) |
| `toolCallLog.listByChat` | `convex/toolCallLog.ts:103-118` | return `[]` for a deleting chat |
| `approveToolCall`/`denyToolCall` shared resolver | `convex/chatRuntime.ts:2210` (`resolveToolCallDecision`) | after resolving the run, `ctx.db.get(run.chatId)`; reject (same not-found error) when missing or `deletingAt !== undefined` |
| `files.getUrl` | `convex/files.ts:195-206` | authorizes on `attachment.userId` only; when `attachment.chatId` is set, load the chat and return `null` if missing or `deletingAt !== undefined` (a tombstoned chat's attachments must stop serving URLs before the attachments phase drains them) |
| `files.getAttachmentPreview` | `convex/files.ts:354-361` | same edit as `getUrl`: chat-bound attachment of a missing/deleting chat → `null` |

`messages.getForChat` / `getLastMessages` / `getSelectedConversation` go through
`getAuthorizedChatForRead` and need no edit — verify by reading their handlers
(`convex/messages.ts:111,139,207`).

### 2.5 List queries — tombstoned chats stay in every `by_user_*` index

Filter them out in each handler (a `.filter()` on the index range; pre-launch, page
underfill on paginated windows is acceptable — note it in a comment):

- `chats.getPinnedForCurrentUser` (`convex/chats.ts:80`)
- `chats.listForCurrentUserPaginated` (`:112`)
- `chats.getRecentWindowForCurrentUser` (`:125`)
- `chats.getProjectChatsForCurrentUser` (`:188`) — also skip when the **project** is
  deleting (the `ownedProjectQuery` builder already throws for it after §2.2)
- `chats.searchByTitle` (`:205`)
- `projects.getForCurrentUser` (`convex/projects.ts:23`)
- `chat_project_link.newestLinkedChat` (`convex/domain/chat_project_link.ts:89`) —
  skip deleting chats so project activity backfill ignores them.

Use one shared predicate, e.g. export `isChatDocActive` from `auth.ts` and
`q.eq(q.field("deletingAt"), undefined)` in index filters.

### 2.6 Reapers — `convex/chatRuntime.ts:2511` and `:2548`

Both crons iterate global status indexes and will meet runs/approvals of chats being
cleaned. For each candidate: load the chat; if missing or `deletingAt !== undefined`,
**skip** (the deletion job owns that graph's teardown). Also make both loops tolerant of
a row deleted between read and patch: wrap the per-item settle in a re-`get` existence
check (OCC already serializes; this avoids a whole-batch failure on one missing doc).

### 2.7 Tests

Lean, targeted (extend existing files; no new files):

- `convex/lib/auth.test.ts`: one case per central helper — a chat/project with
  `deletingAt` set behaves exactly like a missing doc (same error/null).
- `convex/chatRuntimeWorker.test.ts`: grant validation rejects `grant_unauthorized` for
  (a) `chat.deletingAt` set, (b) linked project `deletingAt` set.
- `convex/chats.test.ts` + `convex/messages.test.ts`: one public-surface denial each
  (`getPublicById` → null, `getPublicForChat` → []), one list-filter case.

### 2.8 Verify and commit

`bun run typecheck && bun run lint && bun run test`. Deploy-safety check: with no
tombstones in the database, every test and manual flow behaves identically (this commit
must be a no-op in production terms).

**Commit 2 message:**

```
Deletion tombstones: schema + immediate denial on every access surface

- chats.deletingAt / projects.deletingAt + deletionJobs table
- Central active-root guards in auth helpers (owner, public, run, project)
- Worker grant validation rejects tombstoned roots (grant_unauthorized)
- Hand-checked bypass surfaces: getPublicById, getPublicForChat, projects.getById(WithOwner),
  toolCallLog, approval resolver, markChatRead, list/search queries, reapers
- No writer sets a tombstone yet; behavior-neutral by construction
```

---

## Checkpoint 3 (Commit 3) — Asynchronous cleanup engine + switch `remove` over

**Goal:** replace synchronous graph deletion with tombstone + scheduled bounded drain.
After this commit the two currently-undeletable oversized chats delete successfully.

### 3.1 New domain module — `convex/domain/chat_deletion.ts`

Pure logic + a ctx-Pick seam, mirroring the style of the module it replaces
(`ChatOwnedDeletionCtx = Pick<MutationCtx, "db" | "meta" | "storage" | "scheduler">`).

Exports:

```ts
export const DELETION_PHASES = [
  "assistantMessageSnapshots",
  "toolInvocations",
  "toolApprovalRequests",
  "toolCallLog",
  "messages",
  "generationRuns",
  "attachments",   // includes stored-file reference handling
  "chatRoot",
] as const
// Project jobs: phase "chats" (drain linked chats through the phases above,
// one chat at a time via job.chatId), then "projectRoot".

export const DELETION_BATCH = {
  numItems: 200,
  maximumRowsRead: 400,
  maximumBytesRead: 2 * 1024 * 1024,
  attachmentsPerBatch: 25,
} as const
```

Key functions:

- `ensureChatDeletionJob(ctx, chat, user)` / `ensureProjectDeletionJob(ctx, project, user)`:
  query `deletionJobs.by_chat` / `.by_project` `.first()`; if a non-`complete` job
  exists, return it (idempotent — a second delete request must NOT create a parallel
  cleaner); else insert `{ state: "pending", phase: DELETION_PHASES[0] | "chats", version: 1, counters: 0, timestamps }`.
  Two rules that make overlapping jobs safe:
  - `ensureChatDeletionJob` returns ANY non-complete job whose `chatId` matches —
    including a **project** job currently draining that chat (`targetKind` is not
    filtered). Deleting a chat while its project's cleanup is mid-drain must reuse the
    project job, not race it.
  - Concurrent duplicate `ensure` calls are serialized by Convex OCC: both read the
    same empty `by_chat` range; the second commit's read set is invalidated, it
    retries, sees the first job, and returns it. No explicit lock is needed.
- `runDeletionBatch(ctx, jobId)`: the single-step state machine. Rules:
  1. `ctx.db.get(jobId)`; if missing or `state === "complete"`, return (stale
     invocation — exit silently, never throw).
  2. If `state === "blocked"`, return (manual/reconciler resume only).
  3. Mark `state: "running"`, bump `updatedAt`.
  4. **Child-table phases:** one `paginate` on the phase's chat-scoped index, always
     `cursor: null` (each batch deletes the range prefix, so restarting at null is the
     correct destructive-drain cursor; never persist a row cursor), with
     `DELETION_BATCH` bounds. Index map (all exist today, `convex/schema.ts`):
     - `assistantMessageSnapshots.by_chat_order` eq chatId
     - `toolInvocations.by_chat`, `toolApprovalRequests.by_chat_status` eq chatId,
       `toolCallLog.by_chat`, `messages.by_chat`, `generationRuns.by_chat`
     Delete every row in the page; accumulate `documentsDeleted` and
     `bytesObserved += getConvexSize(row)`. Empty page → advance `phase` to the next
     entry. Non-empty → keep the phase.
  5. **`attachments` phase:** `.take(attachmentsPerBatch + 1)` on
     `chatAttachments.by_chat` (NOT paginate — keep the single-paginate budget free and
     the read bounded). For each attachment in the first `attachmentsPerBatch`:
     - if `storageId`: `.take(2)` on `chatAttachments.by_storage` eq storageId; if the
       only reference is this row, `await ctx.storage.delete(storageId)` (tolerate
       already-missing storage by catching and continuing — idempotent retry);
     - `ctx.db.delete(attachment._id)` always.
     The by_storage read participates in this transaction, so a concurrent new
     reference invalidates and retries the batch (OCC) — that is the shared-file
     safety, do not add a reference counter. Empty range → advance phase.
  6. **`chatRoot` phase:** `ctx.db.get(chatId)` first — a **missing root is success**
     (an overlapping job for the same chat, e.g. a chat job racing its project's job,
     already removed it; deleting a missing id throws and would wrongly block the job).
     If present: assert every child range is empty via seven `.first()` reads (cheap
     point checks); if any non-empty, regress `phase` to that table (defensive — a
     racing legacy writer); else `ctx.db.delete(chatId)`. Then for a chat job mark
     `state: "complete"`, `completedAt`; for a project job clear `job.chatId` and set
     `phase: "chats"`.
  7. **Project `"chats"` phase:** if `job.chatId` set, run step 4-6 semantics for it;
     else `takeLinkedChats(ctx, project, 2)` (`convex/domain/chat_project_link.ts:73`) —
     pick the first, patch it `deletingAt: Date.now()` if unset (idempotent), set
     `job.chatId`, keep phase. Empty → `phase: "projectRoot"`.
  8. **`projectRoot` phase:** `ctx.db.delete(projectId)`, `state: "complete"`.
     The project root is deleted strictly LAST — `requireLinkedProject`
     (`chat_project_link.ts:37-47`) fails closed on dangling `projectId`, so a
     surviving chat must never outlive its project row.
  9. **Continuation:** if not complete,
     `ctx.scheduler.runAfter(0, internal.deletionCleanup.runDeletionBatch, { jobId })` —
     committed atomically with this batch's deletions and progress patch.
  10. **Failure conversion:** wrap steps 4-8; on a thrown developer/invariant error,
      patch `{ state: "blocked", failureCode: "<stable-enum>", retryCount + 1 }` and do
      NOT reschedule. Never expose the chat; never auto-untombstone.

### 3.2 Internal mutations + cron — extend `convex/deletionCleanup.ts`

```ts
export const runDeletionBatch = internalMutation({
  args: { jobId: v.id("deletionJobs") },
  handler: (ctx, { jobId }) => runDeletionBatchImpl(ctx, jobId), // from domain module
})

export const reconcileStalledDeletionJobs = internalMutation({
  args: {},
  handler: ... // by_state_updated: state in (pending, running) with
               // updatedAt < now - 5 min → runAfter(0, runDeletionBatch). Take ≤ 16.
               // "blocked" jobs are NOT auto-resumed; log a content-free count.
})
```

**Blocked-job runbook** (goes in the ADR too): a `blocked` job stays hidden and inert
until an operator inspects `failureCode` in the dashboard and, after fixing the cause,
resumes it manually through the same idempotent entry point:

```bash
bunx convex run deletionCleanup:runDeletionBatch '{"jobId":"<id from dashboard>"}'
```

(Resume must first patch `state` back to `pending` — add a tiny
`internalMutation resumeBlockedDeletionJob { jobId }` that does the patch + schedule,
so the operator runs exactly one command.)

Cron — `convex/crons.ts` (two intervals already exist; add):

```ts
crons.interval(
  "reconcile stalled deletion jobs",
  { minutes: 10 },
  internal.deletionCleanup.reconcileStalledDeletionJobs
)
```

### 3.3 Switch the public handlers

**`convex/chats.ts:547-551`** — replace the body of `remove` (stays `ownedChatMutation`;
note the §2.2 guard makes a second delete of the same chat throw "Chat not found",
which the client already treats as failure-toast — acceptable; if you prefer silent
idempotency, check `ctx.chat.deletingAt` BEFORE the builder would... you cannot: the
builder throws first. Leave it — the chat vanishes from lists immediately, so the menu
is unreachable after the first success):

```ts
export const remove = ownedChatMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const project = await requireLinkedProject(ctx, ctx.chat)
    await ctx.db.patch(ctx.chat._id, {
      deletingAt: now,
      public: false,               // revoke share links in the same commit
      liveRunStatus: undefined,
      statusRunId: undefined,
      liveRunFreshUntil: undefined,
      updatedAt: now,
    })
    const job = await ensureChatDeletionJob(ctx, ctx.chat, ctx.user)
    await ctx.scheduler.runAfter(0, internal.deletionCleanup.runDeletionBatch, {
      jobId: job._id,
    })
    await recordKnownProjectActivity(ctx, project ?? undefined, now)
  },
})
```

**`convex/projects.ts:186-192`** — replace the body of `remove` analogously:
patch `deletingAt` on the project, `ensureProjectDeletionJob`, schedule the first
batch. Do NOT delete the project doc here anymore. Every linked chat is instantly
denied via the `isChatActive` project check from §2.2 — no child patching in this
mutation.

**Client:** no changes. `provider.tsx:312-340` already treats a resolved mutation as
success and relies on the subscription to drop the row; the §2.5 list filters provide
exactly that.

### 3.4 Delete the synchronous collector

- Delete `convex/domain/chat_owned_deletion.ts` and
  `convex/domain/chat_owned_deletion.test.ts` (pre-approved by this plan).
- `rg "chat_owned_deletion|createChatOwnedDeletion|CHAT_OWNED_DELETION"` must return
  zero hits afterward (imports in `chats.ts:10` and `projects.ts` go away in §3.3).

### 3.5 Tests — new file `convex/domain/chat_deletion.test.ts`

Port the fake-ctx harness from the deleted test (`chat_owned_deletion.test.ts:100-226`)
— keep its `paginate` single-call enforcement and add a fake `scheduler.runAfter` that
records `(delayMs, fn, args)` so tests can pump the state machine:

```ts
const pump = async () => {
  while (scheduled.length) {
    const next = scheduled.shift()
    await runDeletionBatchImpl(ctx, next.args.jobId)
  }
}
```

Cases (concentrate on risky logic; no exhaustive permutations):

1. **Full drain:** a chat with rows in all 7 child tables + an exclusive stored file +
   a shared stored file → pump → all child rows gone, exclusive blob deleted, shared
   blob retained, chat root gone, job `complete`, other chats untouched.
2. **Oversized graph across batches:** 1,000 snapshot rows with `numItems: 200` →
   completes in ≥ 5 batches; every batch deleted the range prefix; assert exactly one
   paginate per pump step.
3. **Idempotent duplicate invocation:** run `runDeletionBatchImpl` twice with the same
   jobId concurrently-ish (sequentially, second sees advanced state) → no throw, no
   double-count.
4. **Stale invocation after completion:** invoking a `complete` job exits silently.
5. **Blocked conversion:** inject a throwing `storage.delete` → job becomes `blocked`
   with a `failureCode`, no reschedule, chat root still absent from access (tombstone
   intact).
6. **Project coordination:** project with 3 chats (one oversized) → serial drain, chats
   tombstoned as they are picked, project root deleted last, job `complete`.
7. **Second delete request while cleaning:** `ensureChatDeletionJob` returns the
   existing job (no second job row).
8. **chatRoot regression check:** seed a child row after the messages phase advanced →
   `chatRoot` phase regresses to that table instead of deleting the root.
9. **Overlapping jobs:** create a chat job, then a project job whose coordinator picks
   the same chat; pump both → both reach `complete`, no `blocked` state, chat root
   deleted exactly once (missing-root-is-success path exercised).

Also update `convex/projects.test.ts` / `convex/chats.test.ts` remove-handler tests to
assert: tombstone + job + scheduled batch, and NO synchronous child deletion.

### 3.6 Docs

- New ADR `docs/adr/0014-deletion-logically-immediate-physically-async.md` (short:
  context = 16 MiB transaction limit vs unbounded graphs; decision = tombstone +
  bounded scheduled drain + zero routine snapshot retention; consequences = eventual
  physical reclamation, `deletionJobs` observability, never auto-untombstone).
- `docs/convex-chat-deletion-failure-analysis.md`: add a one-line status header
  pointing at this plan and ADR-0014.

### 3.7 Verify and commit

```bash
bun run typecheck && bun run lint && bun run test
```

Manual smoke on dev (`bun run dev` is usually already running — do NOT kill the user's
server; use the running app):

1. Delete a small chat → row disappears from the sidebar instantly; dashboard shows the
   job progressing to `complete`; child tables empty for that chatId.
2. Delete the known oversized chat (the one that previously threw
   `Too many bytes read`) → mutation resolves instantly; job completes over multiple
   batches; chat physically gone.
3. Delete a chat mid-stream → stream stops with authority-lost (no error storm in the
   route logs), run writes rejected, cleanup completes.
4. Delete a project with linked chats → all linked chats vanish immediately; project
   row deleted last.

**Commit 3 message:**

```
Asynchronous deletion engine: tombstone + bounded scheduled drain

- deletionJobs state machine: one table, one bounded page per mutation,
  cursor:null destructive drain, empty-page phase advancement
- chats.remove / projects.remove: tombstone + ensure job + runAfter(0)
- Stored files: by_storage take(2) exclusivity check in-transaction (OCC-safe)
- Project coordinator drains chats serially, deletes project root last
- Stalled-job reconciler cron (10 min); blocked jobs stay hidden, never resumed
  automatically
- Remove synchronous chat_owned_deletion module (replaced wholesale)
- ADR-0014
```

---

## 4. The PR

One PR from `darknight/justice-buster` → `main`, containing exactly the three commits.
Before opening: `git fetch origin` and diff against `origin/main` (per `AGENTS.md` PR
baseline). Title:

> Chat deletion at scale: zero snapshot retention + tombstoned async cleanup

Body skeleton: link `docs/convex-chat-deletion-failure-analysis.md`, ADR-0014, and this
plan; the three-checkpoint summary; the four manual smoke results from §3.7 with
content-free evidence (job counters, batch counts); rollout notes below.

### Rollout / rollback notes (include in the PR body)

- Deploy is single-shot safe: Checkpoint 2 guards ship inert (no tombstones exist until
  Checkpoint 3 code writes one).
- Rollback seams: `RETAIN_ROUTINE_SNAPSHOT_ROWS=1` restores row retention; reverting
  Commit 3 stops new tombstones but **existing tombstones must stay** — never
  un-tombstone a partially cleaned chat; jobs resume when re-deployed.
- Follow-ups (NOT in this PR): run `purgeLegacySnapshotRows` to drain historical rows;
  after production shows zero legacy runs without `lastSnapshotSequence`, remove the
  fallback probe; then contract the `assistantMessageSnapshots` schema
  (`format`/`delta`/`payload`, eventually the table) through the production preflight.

---

## 5. Pitfall appendix (mistakes this plan exists to prevent)

1. **Do not "clean up" the terminal-message `else` branch** in
   `updateAssistantSnapshotForChat` — it records accepted sequences so stale writes
   reject pre-insert.
2. **Do not use two `paginate` calls in one mutation** — Convex allows one per function.
   The attachments phase uses `.take()` for exactly this reason.
3. **Do not persist a row cursor for destructive drains** — each batch deletes the range
   prefix; `cursor: null` is correct and self-healing under retries.
4. **Do not let cleanup mutations read auth** — scheduled functions have no identity.
   All authorization happens in the initiating owner mutation; the job carries ids only.
5. **Do not add a mutable file reference counter** — the `by_storage` take(2) read in the
   deleting transaction is the truth; OCC invalidates on concurrent inserts; retries
   cannot corrupt an index.
6. **Do not delete the project root before its chats** — `requireLinkedProject` fails
   closed on dangling links and every chat read would start throwing.
7. **Do not purge snapshot rows of non-terminal runs** while the legacy fallback probe
   exists — a paused legacy regeneration could mis-settle as `restore-completed`.
8. **Do not map tombstones to a distinct error** — deleting must be indistinguishable
   from missing on every surface (`Chat not found` / `null` / `[]` /
   `grant_unauthorized`).
9. **Do not skip the `bytesObserved`/counter patches** in each batch — they are the
   only content-free observability for stalled/blocked jobs.
10. **Do not touch `.env.local`, do not kill the running dev server, do not wipe
    production data.** Dev data is disposable if a schema conflict appears; production
    is not.
11. **Do not assume one job per chat.** A chat can be covered by its own job AND its
    project's job (delete chat, then delete project — or the reverse). Every phase must
    treat "row already absent" as success, and `chatRoot` must `get` before `delete`;
    `ensureChatDeletionJob` must return a covering project job instead of creating a
    second drain.
