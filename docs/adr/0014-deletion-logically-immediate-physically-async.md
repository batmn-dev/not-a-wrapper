# 14. Deletion is logically immediate and physically asynchronous

- Status: accepted
- Date: 2026-07-23
- Related: implementation shipped in PR #128; this ADR retains the operating
  decision and blocked-job runbook.

## Context

A Chat's durable graph is unbounded, while one Convex mutation may read at most
16 MiB. The former synchronous deletion path read the complete owned graph
before deleting it, so snapshot-heavy Chats could not be deleted. Routine
assistant snapshots also duplicated cumulative content and caused the graph to
grow much faster than the visible conversation.

## Decision

Deletion is a two-stage operation:

1. The authenticated owner mutation tombstones the Chat or Project. Every read
   and write surface treats that logical root as missing immediately. A linked
   Project is the Chat's logical ancestor: Chat-bound access reads both the Chat
   and its Project and fails closed when either is missing or tombstoned.
2. A `deletionJobs` state machine drains one bounded child-table page per
   scheduled mutation. Destructive pages always restart at `cursor: null`;
   attachments use bounded `take` reads and an in-transaction
   `by_storage.take(2)` exclusivity check. Chat roots are deleted only after
   every child range is empty, and Project roots are deleted only after every
   linked Chat is gone.

Run-level `lastSnapshotSequence` preserves the accepted-checkpoint invariant
without retaining cumulative snapshot rows.

Jobs are idempotent, keep content-free document/byte counters, and schedule
their next batch atomically. Unexpected invariant or storage failures convert a
job to `blocked`; jobs are never auto-untombstoned or automatically resumed.
The reconciler only restarts stale `pending` or `running` jobs. It reports a
bounded count of `blocked` jobs without mutating or scheduling them.

Collection reads that can include project-linked Chats post-filter their bounded
result set through the same parent-aware rule. Parent ids are de-duplicated and
pagination metadata is preserved; a page may therefore underfill while a
Project deletion is draining. Because these Project reads occur in the same
reactive query or mutation, Convex invalidation and optimistic concurrency
ordering make the tombstone authoritative without fan-out writes to child
Chats.

## Consequences

- Deletion disappears from the product immediately while physical reclamation
  is eventual and observable through `deletionJobs`.
- Tombstoning a Project immediately hides and write-disables its linked Chats,
  even before the coordinator reaches their individual roots.
- Large Chats and Projects take multiple transactions but no transaction reads
  the complete graph.
- Existing tombstones must remain hidden through rollback. Reverting the async
  writer stops new tombstones, but partially cleaned roots must never be
  un-tombstoned; their jobs resume after the implementation is re-deployed.

## Blocked-job runbook

Inspect the job's content-free `failureCode` in the Convex dashboard and fix the
underlying cause. Resume the same idempotent job with:

```bash
bunx convex run deletionCleanup:resumeBlockedDeletionJob '{"jobId":"<id from dashboard>"}'
```

The resume mutation changes only `blocked` jobs back to `pending` and schedules
the existing entry point. Do not clear the root tombstone.
