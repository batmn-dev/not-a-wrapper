# 14. Deletion is logically immediate and physically asynchronous

- Status: accepted
- Date: 2026-07-23
- Related: [chat-deletion failure analysis](../convex-chat-deletion-failure-analysis.md),
  [implementation plan](../gameplans/chat-deletion-and-snapshot-retention-implementation-plan.md)

## Context

A Chat's durable graph is unbounded, while one Convex mutation may read at most
16 MiB. The former synchronous deletion path read the complete owned graph
before deleting it, so snapshot-heavy Chats could not be deleted. Routine
assistant snapshots also duplicated cumulative content and caused the graph to
grow much faster than the visible conversation.

## Decision

Deletion is a two-stage operation:

1. The authenticated owner mutation tombstones the Chat or Project. Every read
   and write surface treats that root as missing immediately.
2. A `deletionJobs` state machine drains one bounded child-table page per
   scheduled mutation. Destructive pages always restart at `cursor: null`;
   attachments use bounded `take` reads and an in-transaction
   `by_storage.take(2)` exclusivity check. Chat roots are deleted only after
   every child range is empty, and Project roots are deleted only after every
   linked Chat is gone.

Routine assistant snapshot rows are disabled by default. Run-level
`lastSnapshotSequence` preserves the accepted-checkpoint invariant without
retaining cumulative copies; a temporary deployment setting,
`RETAIN_ROUTINE_SNAPSHOT_ROWS=1`, restores row retention for rollback.

Jobs are idempotent, keep content-free document/byte counters, and schedule
their next batch atomically. Unexpected invariant or storage failures convert a
job to `blocked`; jobs are never auto-untombstoned or automatically resumed.
The reconciler only restarts stale `pending` or `running` jobs.

## Consequences

- Deletion disappears from the product immediately while physical reclamation
  is eventual and observable through `deletionJobs`.
- Large Chats and Projects take multiple transactions but no transaction reads
  the complete graph.
- Existing tombstones must remain hidden through rollback. Reverting the async
  writer stops new tombstones, but partially cleaned roots must never be
  un-tombstoned; their jobs resume after the implementation is re-deployed.
- Historical snapshot rows remain until the bounded manual purge completes.
  Schema contraction is deferred until production preflight proves legacy data
  is gone.

## Blocked-job runbook

Inspect the job's content-free `failureCode` in the Convex dashboard and fix the
underlying cause. Resume the same idempotent job with:

```bash
bunx convex run deletionCleanup:resumeBlockedDeletionJob '{"jobId":"<id from dashboard>"}'
```

The resume mutation changes only `blocked` jobs back to `pending` and schedules
the existing entry point. Do not clear the root tombstone.
