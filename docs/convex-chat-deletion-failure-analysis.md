# Convex Chat Deletion Failure: Root-Cause Analysis and Architecture Recommendation

- **Status:** Superseded by the [implementation plan](gameplans/chat-deletion-and-snapshot-retention-implementation-plan.md) and [ADR-0014](adr/0014-deletion-logically-immediate-physically-async.md)
- **Date:** 2026-07-23
- **Scope:** Production-scale deletion of Chats, Projects, and their owned durable records
- **Request ID investigated:** `9229876ec13626d9`

## Executive summary

The current deletion design tries to read a Chat's complete owned graph into one
Convex mutation before deleting anything. That design is incompatible with an
unbounded Chat graph because Convex limits each query or mutation transaction to
16 MiB of data read.

The reported mutation crosses that limit while awaiting this indexed range:

```ts
assistantMessageSnapshots
  .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
  .take(limit)
```

The range is selective by `chatId`; the problem is not a missing index. The
problem is the amount of matching data and the decision to collect every child
before performing any deletion.

The application attempts to enforce its own 8 MiB deletion budget, but it
measures rows only after `.take()` has returned them. Convex rejects the database
read before the application receives the oversized result, so the application
budget cannot intercept this failure.

Snapshot retention is also a growth root cause. During streaming, the runtime
periodically inserts complete cumulative copies of the assistant's text and
parts. Later snapshots repeat the content already present in earlier snapshots,
and the same text is substantially duplicated between `textSnapshot` and
`partsSnapshot`. At a fixed checkpoint cadence, retained snapshot bytes can grow
approximately quadratically as an answer becomes longer.

The recommended solution is a combined redesign:

1. **Stop retaining routine snapshot history.** Continue atomically projecting
   the latest content onto the canonical assistant message, but replace the only
   historical-row existence probe with the existing run-level
   `lastSnapshotSequence` invariant, or an equivalent explicit Boolean.
2. **Make deletion logically immediate and physically asynchronous.** In one
   small owner-authorized mutation, mark the Chat or Project as deleting, make it
   inaccessible, revoke further worker writes, create a cleanup job, and schedule
   the first internal cleanup mutation.
3. **Delete children in bounded scheduled transactions.** Drain one indexed
   table and one byte-bounded page at a time. Each continuation mutation receives
   a fresh Convex transaction budget, allowing both future Chats and already
   oversized legacy Chats to be deleted.

This combined approach fixes both the immediate deletion failure and the
underlying snapshot-growth problem. A lower `.take()` value, a new index, a
cleaner error, or retrying the same mutation does not.

## 1. Failure and impact

Deleting a durable Chat invokes `chats:remove` and fails with:

```text
[CONVEX M(chats:remove)] [Request ID: 9229876ec13626d9] Server Error
Uncaught Error: Too many bytes read in a single function execution
(limit: 16777216 bytes)

at collectBounded (convex/domain/chat_owned_deletion.ts:86)
at collectChatGraph (convex/domain/chat_owned_deletion.ts:117)
at deleteChat (convex/domain/chat_owned_deletion.ts)
at handler (convex/chats.ts)
```

The client optimistically removes the Chat, awaits `api.chats.remove`, and
restores the row when the mutation rejects:

- [`dialog-delete-chat.tsx`](../app/components/layout/sidebar/dialog-delete-chat.tsx#L38-L45)
  closes the confirmation dialog and calls `onConfirmDelete()`.
- [`chat-actions-menu.tsx`](../app/components/layout/chat-actions-menu.tsx#L52-L60)
  invokes the Chat-store deletion operation.
- [`provider.tsx`](../lib/chat-store/chats/provider.tsx#L312-L336) calls
  `api.chats.remove`; on failure it removes the optimistic operation, records a
  developer diagnostic, and shows a generic error toast.
- [`convex/chats.ts`](../convex/chats.ts#L546-L551) delegates the server operation
  to `createChatOwnedDeletion(ctx).deleteChat(ctx.chat)`.

This is a server transaction-size failure. It is unrelated to Next.js,
Turbopack, React, or client routing.

## 2. Verified immediate root cause

### 2.1 The mutation collects the complete graph before deleting anything

`deleteChat()` performs these operations in order:

1. Add the Chat and linked Project roots to an application budget.
2. Collect all Chat-owned child records.
3. Inspect attachment references to identify exclusive stored files.
4. Check remaining transaction headroom.
5. Delete stored files.
6. Delete all child records.
7. Delete the Chat root.

See
[`chat_owned_deletion.ts`](../convex/domain/chat_owned_deletion.ts#L281-L298).

The owned graph includes:

- `messages`
- `generationRuns`
- `assistantMessageSnapshots`
- `toolInvocations`
- `toolApprovalRequests`
- `toolCallLog`
- `chatAttachments`

Each table is read in sequence through `collectBounded()`. All of those reads
belong to the same Convex mutation transaction.

### 2.2 The failing indexed read is the snapshot range

The stack's `collectChatGraph` line corresponds to:

```ts
const assistantMessageSnapshots = await collectBounded(
  (limit) =>
    ctx.db
      .query("assistantMessageSnapshots")
      .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
      .take(limit),
  budget
)
```

See
[`chat_owned_deletion.ts`](../convex/domain/chat_owned_deletion.ts#L117-L124).

This proves that the transaction crossed the platform threshold while awaiting
the snapshot query. It does **not** prove that snapshots alone were larger than
16 MiB. The transaction had already read the Chat, possibly its Project, every
message, and every generation run. Convex enforces the limit cumulatively across
the mutation.

Determining whether the snapshot range itself exceeded 16 MiB, rather than
merely consuming the remaining transaction headroom, requires safe live
per-table size aggregates that do not currently exist.

### 2.3 Maximum requested `.take()` size

The application deletion limits are:

```ts
documents: 5_000
bytes: 8 * 1024 * 1024
```

`nextRangeReadLimit()` returns one more than the remaining document budget so a
sentinel row can prove that a range exceeds the application limit:

```ts
return Math.min(remainingDocuments, rangeLimit ?? remainingDocuments) + 1
```

Before the snapshot query, the largest requested count is:

```text
5000 - linkedProjectCount - messageCount - generationRunCount
```

Therefore:

- An unlinked Chat with no messages or generation runs could request
  `.take(5000)`.
- A linked Chat with no messages or generation runs could request
  `.take(4999)`.
- The actual failing request was reduced by the number of messages and generation
  runs already collected.

Document count is not a byte bound. A relatively small number of large snapshot
documents can exhaust 16 MiB well before 5,000 rows.

### 2.4 Why the 8 MiB application budget does not protect the mutation

`collectBounded()` first awaits the complete range:

```ts
const rows = await loadRange(nextRangeReadLimit(budget, rangeLimit))
```

Only after that promise resolves does `addToBudget()` iterate through the
returned documents and call `getConvexSize()`.

See
[`chat_owned_deletion.ts`](../convex/domain/chat_owned_deletion.ts#L54-L92).

Convex enforces its 16 MiB platform limit while executing the database read. If
that range takes the transaction beyond the limit, Convex rejects the read before
the application gets the `rows` array. The application therefore never reaches
its 8 MiB check.

The later call to `ctx.meta.getTransactionMetrics()` has the same timing
problem. It runs only after all graph and storage-reference reads have completed:

[`chat_owned_deletion.ts`](../convex/domain/chat_owned_deletion.ts#L206-L231).

Transaction metrics are useful after a byte-bounded read or between small
operations. They cannot make an already unbounded read safe.

### 2.5 Correct document-size measurement

Current Convex documentation distinguishes:

- `getDocumentSize()` for stored documents, including `_id` and
  `_creationTime`.
- `getConvexSize()` for arbitrary Convex values.

For a fetched document that already includes its system fields, the current
`getConvexSize(row)` is likely numerically equivalent with the installed Convex
version. `getDocumentSize()` would still communicate the stored-document intent
more clearly.

Changing the measurement function would not fix this failure. Both functions
run after the database result has been returned to application code.

References:

- [Convex data types and document-size measurement](https://docs.convex.dev/database/types)
- [Convex write-performance and transaction tools](https://docs.convex.dev/database/writing-data)
- The repository currently declares `convex ^1.42.1` in
  [`package.json`](../package.json#L59).

### 2.6 The same structural defect affects Projects and every child table

Project deletion collects up to 250 linked Chats and then calls
`collectChatGraph()` for every Chat inside one mutation:

[`chat_owned_deletion.ts`](../convex/domain/chat_owned_deletion.ts#L300-L325).

The Project handler does not delete the Project until that complete operation
returns:

[`convex/projects.ts`](../convex/projects.ts#L185-L191).

This is more vulnerable than individual Chat deletion because reads and writes
accumulate across multiple complete Chat graphs.

Snapshots triggered this incident, but any child table can trigger the same
platform failure. All child ranges share the same pattern:

1. Read a count-bounded range.
2. Receive every returned document.
3. Measure bytes afterward.

A Chat with sufficiently large messages, tool payloads, logs, or attachments can
therefore fail at a different range even after snapshot retention is fixed.

### 2.7 The existing test harness does not model the platform failure

The fake `.take()` implementation filters and slices an in-memory array. It does
not calculate encoded bytes or interrupt a range when the real platform limit is
crossed:

[`chat_owned_deletion.test.ts`](../convex/domain/chat_owned_deletion.test.ts#L162-L171).

Its fake transaction metrics always report zero used capacity and a fixed
remaining amount:

[`chat_owned_deletion.test.ts`](../convex/domain/chat_owned_deletion.test.ts#L203-L215).

The existing byte-budget test loads 16 messages containing 600 KiB each and then
successfully reaches the application-level 8 MiB error:

[`chat_owned_deletion.test.ts`](../convex/domain/chat_owned_deletion.test.ts#L532-L553).

That proves the application budget rejects an already-returned oversized graph.
It does not prove that the real Convex database can return the same range before
enforcing its own transaction limit.

### 2.8 Failure rollback

The failing snapshot read occurs before file or database deletion starts.
Convex mutations commit all database writes together; if a mutation throws, none
of its database writes commit.

The reported failure should therefore leave the Chat graph intact. This matches
the client behavior, which reverses its optimistic deletion after the mutation
rejects.

References:

- [Convex mutation transactions](https://docs.convex.dev/functions/mutation-functions)
- [Convex error handling](https://docs.convex.dev/functions/error-handling/)

## 3. Snapshot lifecycle and storage amplification

### 3.1 What creates a snapshot row

The durable runtime maintains cumulative text and reasoning buffers. When it
receives a text or reasoning delta, it appends the delta to those buffers and
attempts a throttled persist:

[`durable-turn-runtime.ts`](../app/api/chat/durable-turn-runtime.ts#L569-L635).

The default throttle interval is 750 milliseconds. Each routine persist sends:

```ts
{
  sequence,
  textSnapshot: completeTextSoFar,
  partsSnapshot: completeTextAndReasoningPartsSoFar,
}
```

The runtime also performs one unconditional final write containing the complete
response parts before any terminal transition:

[`durable-turn-runtime.ts`](../app/api/chat/durable-turn-runtime.ts#L638-L662).

The current production call site passes `textSnapshot` and `partsSnapshot`; it
does not pass `payload` or `delta`:

[`durable-turn-runtime.ts`](../app/api/chat/durable-turn-runtime.ts#L1286-L1312).

### 3.2 What the Convex mutation does with each checkpoint

`updateAssistantSnapshotForChat()`:

1. Rejects terminal or stale writes.
2. Inserts a new `assistantMessageSnapshots` row.
3. Patches the assistant message with the checkpoint's content and parts.
4. Patches the generation run with `lastSnapshotSequence` and progress state.

See
[`convex/chatRuntime.ts`](../convex/chatRuntime.ts#L1621-L1703).

The schema allows two historical formats and several optional payload fields:

[`convex/schema.ts`](../convex/schema.ts#L248-L263).

Current source confirms cumulative `textSnapshot` and `partsSnapshot` writes. The
live proportion of older `UIMessageChunk`, `payload`, or `delta` rows was not
measured and must not be inferred.

### 3.3 Why retained bytes grow abnormally

Assume a final answer contains `B` bytes and is written at `n` evenly spaced
checkpoints.

For one cumulative representation, retained bytes are approximately:

```text
B/n + 2B/n + 3B/n + ... + nB/n
= B(n + 1) / 2
```

Current rows substantially represent the text twice:

1. Directly in `textSnapshot`.
2. Inside the text part of `partsSnapshot`.

Ignoring reasoning, tool parts, indexes, and document overhead, the two
representations retain roughly:

```text
B(n + 1)
```

At a fixed generation rate and a fixed checkpoint interval, the number of
checkpoints grows with answer length. Retained bytes therefore approach
quadratic growth as the answer gets longer.

This amplification is storage growth, write amplification, and future deletion
read amplification at the same time.

### 3.4 Snapshot rows are not the recovery source of truth

Current recovery behavior reads the assistant message document:

- The snapshot mutation patches the assistant message on every accepted
  checkpoint.
- Reload and reconnect render durable message documents rather than replaying
  snapshot rows.
- The client deliberately keeps no second durable copy for authenticated Chats.

Sources:

- [`ADR-0008`](adr/0008-no-stream-resume-read-surface.md#decision)
- [`turn-store.ts`](../lib/chat-turn/turn-store.ts#L18-L26)

The terminal completion mutation also writes the final content and parts
directly onto the assistant message:

[`convex/chatRuntime.ts`](../convex/chatRuntime.ts#L1771-L1843).

No successful terminal path compacts or removes the historical snapshot rows.
They remain until full Chat deletion.

### 3.5 The one remaining historical-row read

When a regeneration reuses an older assistant message, terminal settlement
queries whether the current run has at least one snapshot row:

[`convex/chatRuntime.ts`](../convex/chatRuntime.ts#L465-L473).

That Boolean distinguishes:

- A regeneration that died before producing its first accepted output, in which
  case the previous answer should be restored.
- A regeneration that produced output, in which case the new partial answer
  should be preserved and stamped with its terminal result.

The lifecycle rule is defined in
[`generation_run_lifecycle.ts`](../convex/domain/generation_run_lifecycle.ts#L122-L159).

The query does not inspect historical content. It asks only whether accepted
output exists for the run.

### 3.6 Replace the row probe with a run-level invariant

`generationRuns.lastSnapshotSequence` is already patched in the same mutation as
every accepted assistant projection:

[`convex/chatRuntime.ts`](../convex/chatRuntime.ts#L1681-L1701).

Because sequences begin above zero, this field can answer the regeneration
question:

```text
lastSnapshotSequence > 0
```

For a safe compatibility transition:

1. Initialize new runs with `lastSnapshotSequence: 0`, or add an explicit
   `hasProjectedOutput: false`.
2. Continue atomically advancing the field whenever a projection is accepted.
3. For legacy runs where the field is absent, temporarily fall back to the
   snapshot-row existence query.
4. Prove the run-level signal is populated correctly in production.
5. Remove routine snapshot-row insertion.
6. Delete legacy rows in bounded scheduled batches.
7. Remove the legacy existence-query fallback.

### 3.7 Recovery and terminal cases after row retirement

Historical rows are not required for the currently implemented cases:

- **Reload:** the latest assistant message projection is the durable read model.
- **Stop:** the runtime performs a final full-parts projection before the abort
  transition.
- **Provider or request failure:** the latest accepted message projection remains
  available and terminal settlement stamps it.
- **Approval pause and continuation:** authority lives in run, message, approval,
  and continuation fields.
- **Lease expiry or worker death:** the last accepted assistant projection
  survives; the reaper settles run/message state.
- **Regeneration before output:** the run-level projected-output invariant is
  false, so the older answer is restored.
- **Regeneration after output:** the invariant is true, so the partial result is
  kept.
- **Stale checkpoint:** sequence comparison still rejects it before projection.

The recommended steady state is zero retained routine snapshot rows. If a future
product or audit requirement needs a terminal record independent of the
assistant message, define one compact terminal record explicitly. Do not retain
the current cumulative history by default.

## 4. Relevant Convex platform behavior

### 4.1 Transaction limits

Current Convex limits for each query or mutation include:

- 16 MiB data read.
- 16 MiB data written.
- 32,000 documents scanned.
- 4,096 index ranges read.
- 16,000 documents written.

Calling helpers or nested functions does not create a new top-level transaction
budget. Work must cross into a newly scheduled mutation to receive a fresh
allowance.

Reference:
[Convex transaction limits](https://docs.convex.dev/production/state/limits).

### 4.2 Byte-bounded pagination

`paginate()` accepts:

- `maximumBytesRead`
- `maximumRowsRead`

If a requested page would exceed those bounds, Convex splits the page instead of
performing an unbounded range read.

This is valuable for:

- Content-safe diagnostics.
- Per-batch cleanup.
- Controlled preflight errors.
- Protecting transaction headroom before application logic inspects the page.

It does not reset transaction consumption. Repeated pages inside the same
mutation continue consuming the same transaction allowance.

References:

- [Convex paginated queries](https://docs.convex.dev/database/pagination)
- [Convex `PaginationOptions`](https://docs.convex.dev/api/interfaces/server.PaginationOptions)

### 4.3 Transaction metrics

`ctx.meta.getTransactionMetrics()` reports used and remaining capacity for reads,
writes, document counts, and database queries.

It should be used:

- After a byte-bounded page.
- Before optional follow-up queries.
- During small per-item cleanup loops.
- To preserve explicit headroom for job progress and continuation scheduling.

It should not be treated as protection for a preceding unbounded `.take()`.

Reference:
[Convex write-performance guidance](https://docs.convex.dev/database/writing-data).

### 4.4 Scheduled continuation mutations

Scheduling from a mutation is atomic:

- If the initiating mutation commits, its scheduled function is guaranteed to be
  scheduled.
- If the initiating mutation fails, no function is scheduled.

Scheduled mutations are executed exactly once. Convex retries internal Convex
errors automatically; developer errors fail and require application-level
handling or reconciliation.

Auth is not propagated to scheduled functions. The owner and target must be
validated in the initiating mutation, and the internal cleanup job must carry
only the minimum identifiers and state needed to continue.

Reference:
[Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions).

The repository already uses the same schedule-after-commit continuation shape
for the Project timestamp backfill:

[`convex/projects.ts`](../convex/projects.ts#L128-L174).

### 4.5 File deletion

Convex permits `ctx.storage.delete()` inside a mutation:

[Convex file deletion](https://docs.convex.dev/file-storage/delete-files).

The cleanup design should keep the last-reference query, stored-file deletion,
and attachment deletion within the same small mutation. That allows the
reference-range read to participate in Convex's optimistic concurrency
protection.

### 4.6 Workpool and Workflow

No new dependency is justified for this cleanup.

Built-in scheduled mutations are sufficient for a serial, database-local state
machine. Workpool becomes relevant only if production evidence requires queue
priorities or controlled concurrency across a large backlog. Workflow becomes
relevant only if the cleanup develops a materially more complex multi-step
orchestration requirement.

Reference:
[Convex scheduling overview](https://docs.convex.dev/scheduling/overview).

## 5. Solution options

### Option A: Guardrail only

Replace unbounded `.take()` preflight reads with byte-bounded pagination and
return a controlled application error for oversized graphs.

**Advantages**

- Prevents the current platform exception from leaking through this path.
- Produces a predictable error message.
- Useful as a temporary diagnostic or safety improvement.

**Limitations**

- The user still cannot delete the Chat.
- It does not stop snapshot accumulation.
- It does not clean already oversized graphs.
- It does not make Project deletion scalable.

**Conclusion:** Useful guardrail, not a root-cause fix.

### Option B: Prevent snapshot accumulation

Keep projecting content onto the assistant message and run, replace the
regeneration-existence query with a run-level field, and stop retaining routine
snapshot rows.

**Advantages**

- Removes the known abnormal growth source.
- Reduces storage and write amplification.
- Preserves current recovery semantics.
- Makes most future Chat graphs substantially smaller.

**Limitations**

- Existing oversized Chats remain undeletable under the synchronous collector.
- A different unbounded child table can still exceed the transaction limit.
- Project deletion still combines multiple graphs into one transaction.

**Conclusion:** Necessary lifecycle correction, but incomplete by itself.

### Option C: Asynchronous batched deletion

Atomically tombstone the root, deny all access and writes, then delete children
in bounded scheduled mutations.

**Advantages**

- Makes deletion work for already oversized legacy graphs.
- Gives users immediate deletion behavior.
- Gives every batch a fresh transaction budget.
- Generalizes to all child tables and Project cascades.

**Limitations**

- Snapshot storage continues growing if the lifecycle is unchanged.
- Requires a deletion state, job model, authorization audit, and retry-safe
  cleanup.
- Physical storage is reclaimed eventually rather than in the initiating
  mutation.

**Conclusion:** Necessary deletion correction, but incomplete without snapshot
lifecycle repair.

### Option D: Combined lifecycle and deletion redesign

Stop routine snapshot retention and adopt tombstoned scheduled cleanup.

**Advantages**

- Fixes the reported failure.
- Fixes the upstream snapshot-growth cause.
- Deletes already oversized legacy Chats.
- Supports unbounded future Chats and Projects.
- Keeps user-visible deletion immediate.
- Uses existing Convex primitives and indexes.

**Costs**

- Requires coordinated schema, auth, worker, lifecycle, cleanup, testing, and
  rollout changes.
- Requires explicit observability and stalled-job reconciliation.

**Conclusion:** Recommended best-practice root fix.

## 6. Recommended architecture

### 6.1 Snapshot projection state

```text
prepared
  -> projecting
  -> terminally projected
  -> settled
```

The projection operation should:

1. Verify run, message, Chat, and worker authority.
2. Reject terminal or stale writes.
3. Patch the assistant message with current content and parts.
4. Advance `lastSnapshotSequence` and progress fields on the run.
5. Avoid inserting a routine retained snapshot row.

The final full-parts projection remains mandatory before terminal settlement. The
change is to retention, not to durability or settlement ordering.

### 6.2 Logical deletion and physical cleanup state

```text
active
  -> deletion_requested_and_hidden
  -> cleaning
  -> physically_deleted
```

A persistent cleanup error may produce:

```text
cleaning
  -> blocked_or_retryable
```

The root remains hidden in every non-active state. Partial cleanup never moves a
Chat back to active.

### 6.3 Initiating Chat deletion

The owner-facing mutation should remain small:

1. Authenticate the current user.
2. Resolve the Chat.
3. Verify ownership.
4. Atomically mark the Chat as deleting.
5. Remove public/share visibility in the same write.
6. Insert or ensure one cleanup job.
7. Schedule the first internal cleanup mutation with `runAfter(0)`.
8. Return only after the tombstone and scheduled continuation commit.

The current client can continue treating a resolved mutation as successful. It
does not need to wait for physical cleanup because all read and mutation surfaces
will already treat the Chat as unavailable.

### 6.4 Immediate access denial

The deletion marker must be enforced centrally, before public or owner access is
granted.

At minimum, update:

- `getAuthorizedChatForRead()`
- `requireOwnedChat()`
- `requireOwnedGenerationRun()`
- `requireOwnedProject()`
- grant-authorized worker lookup
- Chat and Project list queries
- public/shared Chat queries
- direct child-resource reads and mutations

Current authorization helpers resolve ownership but have no deletion-state
check:

[`convex/lib/auth.ts`](../convex/lib/auth.ts#L77-L137).

Public access must check the deletion marker before returning a `public` Chat.
Owner access must reject deleting Chats exactly like unavailable resources.

For linked Chats, access must also reject a deleting or missing parent Project.
This is required for immediate Project deletion without synchronously patching
every child Chat.

### 6.5 Revoke active worker authority

Worker grant validation already reads the generation run and its Chat:

[`chatRuntimeWorker.ts`](../convex/chatRuntimeWorker.ts#L90-L113).

Add the active-Chat and active-Project requirement to that shared validation.
The root marker then revokes every existing run grant without scanning or
patching all generation runs.

This also resolves deletion races through Convex optimistic concurrency:

- If a worker transaction commits first, the deletion transaction retries and
  then marks the Chat.
- If deletion commits first, the worker retry observes the marker and rejects.

Every Chat-owned creation path, including files and tool state, must use the same
active-root invariant so cleanup cannot race with new children.

### 6.6 Cleanup job model

A deletion job should contain only operational state, for example:

- Target kind: Chat or Project.
- Target ID.
- Owner ID for internal consistency checks.
- State: pending, running, retryable, blocked, complete.
- Current phase.
- Job format/version.
- Created, started, updated, and completed timestamps.
- Aggregate batches, documents, and bytes processed.
- Retry count.
- Stable content-free failure code.
- Optional scheduled-function ID or next reconciliation timestamp.

Do not store message content, snapshot payloads, tool payloads, secrets, grants,
or copied Chat data in the job.

Uniqueness should be enforced by a target index and an idempotent "ensure job"
operation so repeated user requests do not create parallel cleaners.

### 6.7 Per-table cleanup phases

Use one canonical ordered phase registry:

1. `assistantMessageSnapshots`
2. `toolInvocations`
3. `toolApprovalRequests`
4. `toolCallLog`
5. `messages`
6. `generationRuns`
7. `chatAttachments` and stored files
8. Chat root
9. Project root after every Chat is complete

Leaves are removed before the run/message/root records they reference. Both
individual Chat deletion and Project deletion must delegate to this same
registry so a child table cannot be silently omitted from one path.

### 6.8 Transaction and page budgets

Start conservatively with one paginated indexed range per mutation:

```text
numItems: 64
maximumRowsRead: 128
maximumBytesRead: 2 MiB
```

After the page is returned:

- Delete only that page.
- Inspect `ctx.meta.getTransactionMetrics()`.
- Preserve at least 2 MiB of read and write headroom.
- Preserve several hundred query and document operations for progress updates,
  reference checks, and scheduling.
- Commit the job progress and next schedule atomically with the deletions.

These are rollout starting values, not permanent platform constants. Tune them
from production transaction metrics while remaining well below Convex limits.

### 6.9 Cursor strategy

For destructive indexed draining, always begin the next batch at `cursor: null`.

Each successful batch removes the beginning of the range. Querying the beginning
again avoids advancing a cursor across a dataset whose preceding rows have been
deleted.

The job persists the phase and aggregate progress rather than a row cursor:

```text
query first bounded page
  -> delete page
  -> schedule same phase
  -> repeat
  -> empty page
  -> advance phase
```

The next scheduled mutation is a new transaction and receives a fresh read
budget.

### 6.10 Idempotency, retries, and permanent failures

Every phase must treat these states as success:

- The target row is already absent.
- The page was already deleted.
- The job has already advanced.
- The root was already physically removed.
- A stored file is already absent.

Use job version and phase checks before applying work. A stale or duplicate
invocation should exit without changing newer state.

Scheduled mutations automatically retry internal Convex failures. Developer or
invariant failures should be converted at the job boundary into a stable,
content-free blocked/retryable status instead of exposing the Chat.

A periodic internal reconciler should find jobs that are pending, retryable, or
stalled beyond a threshold and reschedule them. Manual administrative resume can
use the same idempotent path.

### 6.11 Shared and exclusive stored files

Do not introduce a mutable reference counter for this fix. Continue using
`chatAttachments.by_storage` as the source of truth.

For each target attachment, in a small mutation:

1. Read the target attachment.
2. Query at most two references for its `storageId`.
3. If another reference exists, delete only the target attachment.
4. If the target is the only reference, delete the stored file and the target
   attachment.

Because the reference index is read in the same mutation, a concurrent
attachment of that storage ID changes the read range and causes Convex OCC to
retry the cleanup transaction. On retry, the file is recognized as shared.

This protects shared files and avoids scheduler retry corruption of an
independent reference count.

### 6.12 Project deletion

The owner-facing Project mutation should:

1. Verify owner access.
2. Mark the Project as deleting and hide it.
3. Create or ensure a Project cleanup job.
4. Schedule its coordinator.

Every linked Chat becomes immediately inaccessible because active-Chat
authorization also requires an active parent Project.

The coordinator repeatedly selects one linked Chat and runs the canonical Chat
cleanup state machine. It physically deletes the Project only after no linked
Chats or Project-owned children remain.

The coordinator can process Chats serially initially. Workpool or controlled
parallelism should be considered only if measured cleanup backlog requires it.

## 7. Invariants the design must preserve

### Authorization

- Only the authenticated owner can initiate deletion.
- Internal scheduled functions cannot create deletion authority.
- Cross-owner or corrupt Chat/Project links fail closed.

### Immediate deletion behavior

- A tombstoned Chat is unavailable through all query and mutation surfaces.
- A tombstoned Project immediately makes every linked Chat unavailable.
- Public/shared access is removed in the initiating transaction.
- Returning success means logical deletion has committed, not merely that a
  background request was accepted while the Chat remains readable.

### Worker and child-write authority

- Active workers cannot append snapshots, messages, tool records, approvals,
  logs, or attachments after deletion commits.
- New child writes require an active Chat and active linked Project.
- A stale worker grant cannot bypass the root deletion marker.

### Cleanup correctness

- Cleanup is idempotent and retryable.
- Every child table appears in one canonical phase registry.
- Physical root deletion happens only after final empty-range checks.
- Partial cleanup cannot resurrect or expose a Chat.
- A permanently blocked cleanup remains hidden and observable.

### Stored files

- Shared files remain while referenced by another attachment.
- Exclusive files are eventually deleted.
- The reference decision and deletion happen in one mutation.
- Retries cannot double-decrement or corrupt reference state.

### Production data

- Production remains stateful throughout rollout.
- Schema expansion precedes behavioral activation.
- Legacy fallback remains until production compatibility is proven.
- Production data is never wiped to work around this failure.

## 8. Implementation plan

This is a responsibility map, not an implementation.

### `convex/schema.ts`

- Add optional Chat and Project deletion state/timestamps.
- Add the cleanup job table and indexes.
- Initialize or version the run-level projected-output invariant.
- Keep production-compatible optional fields through the transition.

### `convex/lib/auth.ts`

- Add central active-Chat and active-Project guards.
- Make public, owner, generation-run, and Project access reject tombstones.
- Treat a missing linked Project as unavailable for a Chat that carries a
  `projectId`.

### `convex/chatRuntimeWorker.ts`

- Add active Chat/Project validation to grant-authorized worker writes.
- Preserve the existing nondisclosing unauthorized response.

### `convex/chatRuntime.ts`

- Replace the historical snapshot existence probe with the run field.
- Keep checkpoint sequencing and atomic assistant-message projection.
- Stop inserting routine retained rows after the compatibility signal is proven.
- Preserve final full-parts projection before terminal settlement.

### `app/api/chat/durable-turn-runtime.ts`

- Preserve throttling and final-flush semantics.
- Treat the operation as a durable projection/checkpoint rather than requiring an
  append-only history row.
- Retain content-free checkpoint metrics.

### `convex/domain/chat_owned_deletion.ts`

- Replace complete graph collection with tombstone/job initiation and bounded
  phase handlers.
- Keep the canonical owned-child inventory here or in a deeper dedicated module.
- Share the same Chat cleanup implementation with Project deletion.

### `convex/chats.ts` and `convex/projects.ts`

- Keep public handlers owner-authorized.
- Commit tombstone, job, and first schedule atomically.
- Return after logical deletion rather than waiting for physical cleanup.

### New internal cleanup module

- Per-table continuation mutations.
- Attachment/file-reference cleanup.
- Project coordination.
- Legacy snapshot cleanup.
- Stalled-job reconciliation.
- Content-free aggregate diagnostics.

### Tests and documentation

- Replace the synchronous atomic deletion contract in tests and comments.
- Add real Convex integration coverage for byte-bound page behavior.
- Document immediate invisibility versus eventual physical reclamation.

## 9. Test plan

### Transaction-size cases

- A few snapshot rows close to the maximum document size.
- Thousands of small snapshot rows.
- More than 16 MiB of total Chat-owned child data.
- A large messages table with few or no snapshots.
- Large tool or log payloads that trigger a different phase.
- Page splitting by `maximumBytesRead`.
- Page splitting by `maximumRowsRead`.

### Project cases

- Several large Chats in one Project.
- Project deletion while one Chat cleanup is blocked.
- Project deletion with a mixture of small and legacy oversized Chats.
- Repeated Project deletion requests.

### Lifecycle cases

- New run before any accepted output.
- Regeneration before first accepted output restores the old answer.
- Regeneration after accepted output preserves the partial new answer.
- Reload during streaming.
- Stop during an in-flight checkpoint.
- Approval pause and continuation.
- Approval expiry.
- Lease expiry and worker death.
- Provider failure and request abort.
- Terminal completion after a final full-parts projection.
- No historical rows retained after successful settlement.

### Deletion races

- Worker commits immediately before the deletion marker.
- Deletion marker commits immediately before a worker write.
- Attachment creation races attachment cleanup.
- A public-read request races deletion.
- A second deletion request races the first.

### Retry and resumption

- Scheduled mutation internal retry.
- Duplicate invocation of the same phase.
- Stale phase invocation after job advancement.
- Failure after page read but before commit.
- Developer/invariant failure recorded as blocked.
- Reconciler resumes a stalled job.
- Cleanup resumes after deployment rollback and redeploy.

### Stored files

- Exclusive file is deleted.
- Shared file remains.
- Multiple references inside the target graph.
- Reference outside the target graph.
- Stored file already absent.
- Attachment already absent.
- Concurrent creation changes exclusive status and forces OCC retry.

### Immediate access denial

After the tombstone commits, verify denial through:

- Chat lists and sidebar windows.
- Direct owner Chat queries.
- Public/shared Chat queries.
- Message queries and mutations.
- Generation-run mutations.
- Worker grant writes.
- Tool and approval functions.
- Attachment and file functions.
- Project queries and linked Chat access.

### Legacy cleanup

- Legacy run with snapshot rows but no run-level field.
- Legacy run with both current and older snapshot formats.
- Already oversized Chat graph.
- Snapshot cleanup followed by Chat deletion.
- Chat deletion without waiting for global legacy cleanup.

## 10. Production rollout and observability

### Rollout order

1. Deploy optional schema fields and cleanup job storage.
2. Deploy deletion-aware auth and worker guards while no tombstones exist.
3. Populate the run-level projected-output invariant for all new writes.
4. Retain the legacy row probe for absent/legacy run state.
5. Verify the run field agrees with accepted checkpoint behavior.
6. Stop inserting routine snapshot rows behind a server-controlled rollback seam.
7. Deploy Chat tombstone-and-schedule deletion.
8. Deploy Project tombstone-and-coordinate deletion.
9. Begin bounded cleanup of legacy snapshot rows.
10. Remove the legacy row probe only after production validation.
11. Contract obsolete snapshot schema/table state only after the rollback window
    and production preflight.

Already oversized Chats become deletable when the new deletion state machine is
enabled. They do not need to wait for the global legacy snapshot purge.

### Safe metrics

Collect only content-free aggregates:

- Cleanup jobs by state and phase.
- Oldest hidden job age.
- Batch count per job.
- Documents and encoded bytes processed per phase.
- Transaction read/write/query headroom.
- Retry counts and stable failure-code enums.
- Cleanup completion latency percentiles.
- Snapshot rows and encoded bytes per run.
- Aggregate snapshot format counts.
- Completed runs retaining zero snapshot rows.
- Total snapshot-table document and byte growth.
- Shared versus exclusive stored-file decisions as counts.

Never record:

- Prompts or assistant text.
- Snapshot payloads or message parts.
- Tool inputs, outputs, or reasoning.
- File names or URLs.
- Credentials, tokens, grants, or digests.
- Chat, message, run, or storage IDs in analytics/log payloads.

### Validation targets

Snapshot growth is stabilized when:

- New completed runs retain zero routine snapshot rows.
- Snapshot bytes written per run fall to the projection-only baseline.
- Total snapshot-table documents and bytes trend downward as legacy cleanup runs.

Deletion is healthy when:

- Tombstone mutations remain far below transaction limits.
- Cleanup batches preserve configured headroom.
- Oldest hidden-job age remains bounded.
- Blocked-job count is zero or explicitly investigated.
- Legacy Chats larger than 16 MiB complete physical cleanup.

### Rollback

- Disabling new cleanup scheduling must not remove existing tombstones.
- Existing jobs remain hidden and resumable.
- Never untombstone a partially cleaned target automatically.
- Snapshot-row insertion can temporarily be restored without changing the
  canonical assistant-message projection.
- Historical rows already deleted are not reconstructible, but current source
  establishes that they are not a recovery read surface.

## 11. Rejected shortcuts

### Raise the application document limit

This allows more data into the same fixed platform transaction and increases the
likelihood of a Convex limit failure. It does not bound bytes.

### Lower `.take()` without new transactions

Several smaller reads inside one mutation still consume one cumulative
transaction budget.

### Add another index

`by_chat_order` already restricts snapshots to one `chatId`. The matching data
volume, not index selectivity, is the problem.

### Catch and retry the identical mutation

The same deterministic code reading the same graph will hit the same limit.
Conflict retries do not change the transaction-size requirement.

### Return success while leaving the Chat accessible

This violates deletion semantics and allows workers to continue growing the
graph. Success is valid only after logical invisibility and write revocation
commit.

### Delete only snapshot rows manually

This does not:

- Replace the regeneration probe safely.
- Stop future accumulation.
- Handle other oversized child tables.
- Fix Project deletion.
- Establish idempotent cleanup.

It is an incident workaround, not an architecture.

### Wipe production data

Production data is stateful and must be migrated and cleaned safely. Development
database disposability does not apply to production incident handling.

### Add an external queue or database

Convex already supplies atomic scheduling, transactional mutations, retries,
indexes, and file storage. An external system would add another authority and
failure domain without solving a missing platform capability.

### Preserve synchronous atomic physical deletion

An unbounded graph cannot be guaranteed to fit into a bounded transaction.
Immediate logical deletion plus eventual physical cleanup is the sustainable
contract.

## 12. Confirmed facts, inferences, and remaining questions

### Confirmed from current executable source

- `chats:remove` synchronously collects the complete owned graph.
- The reported failure occurs while awaiting
  `assistantMessageSnapshots.by_chat_order`.
- Application byte measurement happens after the range returns.
- Snapshot checkpoints contain cumulative text and parts.
- Every accepted snapshot also patches the assistant message and generation run.
- Historical rows are not replayed during reload or recovery.
- The only behavioral historical-row read is the regeneration-existence probe.
- `lastSnapshotSequence` is already stored on the generation run.
- Snapshot rows are not compacted after successful settlement.
- Project deletion accumulates multiple Chat graphs in one transaction.
- The fake deletion harness does not model real Convex byte-read enforcement.
- The failure occurs before any deletion begins.

### Strong architectural inferences

- Cumulative snapshots are the most likely source of abnormal graph growth.
- The same text is substantially duplicated within and across current snapshot
  rows.
- At fixed cadence and generation rate, retained snapshot bytes grow
  approximately quadratically with long responses.
- Replacing the existence probe with the run field preserves current recovery
  behavior.
- Synchronous physical deletion cannot remain correct for an unbounded graph.

### Unverified live-data facts

- Whether snapshots alone exceeded 16 MiB for the failing Chat.
- Exact per-table counts and encoded sizes.
- Snapshot size percentiles and maximum row size.
- Current versus legacy snapshot-format distribution.
- Live frequency of `payload` or `delta` fields.

The documented production deployment was verified, but the exact Request ID was
no longer present in retained logs. No live documents were read because the
deployment does not currently expose a purpose-built, content-safe,
byte-bounded aggregate diagnostic.

### Open questions

1. What was the failing Chat's exact per-table encoded-size distribution?
   Answer this with a new internal read-only diagnostic that returns only bounded
   counts, totals, percentiles, formats, and maximum sizes.
2. Does the product require a forensic or audit snapshot independent of the
   canonical assistant message? No such requirement or reader exists in current
   source. Without an explicit requirement, retain zero historical snapshot
   rows.

## Final recommendation

Implement **Option D: combined snapshot lifecycle and asynchronous deletion
redesign**.

The system should no longer attempt to prove that an unbounded Chat graph fits
inside one transaction. It should make deletion immediate by atomically removing
access and write authority, then reclaim physical data through small,
idempotent, byte-bounded scheduled transactions.

At the same time, it should stop retaining routine cumulative snapshot history
because the assistant message is already the canonical durable projection and
the sole historical-row probe can be represented on the generation run.

Together, these changes:

- Fix the reported production failure.
- Prevent recurrence from future snapshot growth.
- Delete already oversized legacy Chats.
- Scale Project deletion across multiple large Chats.
- Preserve owner authorization and immediate user-facing deletion.
- Revoke active workers safely.
- Protect shared files.
- Keep cleanup retryable, observable, and content-free.
- Avoid unnecessary dependencies or external infrastructure.
