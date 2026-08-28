# ADR-0027: Split the selected-conversation subscription

**Status:** Proposed — implemented behind `NEXT_PUBLIC_SPLIT_SELECTED_QUERY`
(default off; the atomic query is the rollback path)
**Date:** 2026-08-28

## Context

`messages.getSelectedConversation` is the owner's primary chat subscription:
the selected visible path AND the linked run's state in one query, introduced
atomic because "content and run state can never tear." Its cost profile,
measured in Experiment 2 of the performance plan
(`docs/performance/2026-08-28-experiment-2-reactive-read-split.md`):

- Convex invalidation is read-set based. The atomic query reads every message
  in the chat, so EVERY write in the chat invalidates it — including writes
  that change nothing it projects.
- During a streaming turn the run doc is patched on every snapshot beat
  (`lastSnapshotSequence`/`lastProgressAt`, even when content dedupes),
  every heartbeat (10 s cadence), every tool step, and every approval
  transition. Each of those run-doc-only writes re-executed the full message
  collect and re-delivered the whole selected path (~23 KB measured) to every
  subscriber — per tab.
- Real conversations are dominated by exactly those content-free windows:
  thinking pauses, tool waits, approval waits.

The obvious alternative — indexing selected messages so the path query reads
fewer rows — is structurally unsafe and rejected: legacy chats have no branch
fields, `selected: undefined` messages are path-eligible, role-scoped
deselection leaves stale `selected: true` flags off-path, and sibling
ordering/descriptors need the whole order group. The path derivation must
remain the branch-context collect.

## Decision

Split the subscription into two queries on the same `readableChatQuery`
builder, both keyed by `chatId` alone:

1. **`getSelectedPath`** — the selected visible path, derived by the SAME
   collect + `createBranchContext` code as the atomic query (byte-identical
   branch semantics), plus a derived `pathVersion` fingerprint. Read set:
   chats/projects/users/messages only — run-doc writes no longer touch it.
2. **`getSelectedRunState`** — the tiny per-beat run facts
   (`SelectedRunProjection`, ~177 B measured). Owner-only. Its read set
   excludes the messages table entirely while the run is live (see the
   points-back trim below), so content beats no longer re-execute it either.

The §7 validation gauntlet splits across the seam:

- **Server-side** (in `getSelectedRunState`): run↔chat linkage, ownership,
  and points-back. Points-back short-circuits on
  `run.activeStreamId === run.assistantMessageId` — stamped at stream start,
  cleared on terminal transitions — which is decidable from the run doc
  alone. Only a settled run falls back to reading the linked message's
  `generationRunId` stamp (the doc is no longer written per beat then).
  When the short-circuit hits, the linked message's *existence* is not
  verified; a dangling id can never appear in the delivered path, so the
  client-side check below nulls exactly those cases.
- **Client-side** (messages provider): the on-selected-path check. The
  provider nulls the run unless its `assistantMessageId` is present in the
  DELIVERED path — the same predicate the atomic query evaluated
  server-side, applied to the same data.

### Why the client-side half does not reintroduce tearing

The historical warning — "do NOT wrap `getForChat` with an independent run
subscription" — was about subscriptions whose *arguments* derive from another
query's *result* (a second round trip against a moved database). That is
still forbidden. The split pair is different: one `ConvexReactClient` applies
every subscribed query's updates from a single transition atomically
(`browser/sync/remote_query_set`), and both queries take only `chatId`. Two
same-client, same-argument-source queries can never deliver values from
different database timestamps. The provider's on-path check therefore always
compares a run and a path from ONE transaction view — which is precisely why
the check could move client-side without weakening it.

This basis is Convex-client-scoped: it does NOT license split subscriptions
across different Convex clients, across argument-dependent queries, or
through any cache that decouples the two deliveries.

### Projection slimming

`SelectedRunProjection` drops `lastSnapshotSequence`, `lastProgressAt`, and
`activeToolNames` (zero production consumers; the first two forced a
re-delivery on every beat by construction), and `pendingApproval` shrinks to
`{expiresAt}` — presence and expiry are all the client reads; approval UI is
driven from message parts. No time-derived fields cross the wire: Convex
queries re-execute on data changes, never on wall-clock time, so freshness
classification stays client-side.

## Consequences

- Run-doc-only events (heartbeats, deduped beats, tool steps, approval
  bookkeeping) cost one ~177 B run-state delivery per subscriber instead of a
  ~23 KB path re-collect + re-delivery. Content beats still re-execute the
  path query — per-execution read cost is untouched by this ADR (that is
  Experiment 2b, range-bounded settled-history pagination, gated on
  prefix-derivability property tests).
- Parity is pinned by tests: split halves reproduce the atomic projection
  for owners; non-owner denial identical; points-back nulling server-side;
  on-path nulling client-side; and the run half's live-run read set excludes
  the message doc (spy test).
- Flipping the flag default requires the pause-heavy scenario measurement
  (durable suite `durable-text-30-paused`) showing the event-class win with
  no client regressions. Measured 2026-08-28 (report addendum): pause-window
  delivery −98.6% (24 × 12.7 KB re-collects → 24 × 177 B), zero pause-caused
  path executions, live run-state reads 13 KB → 2 KB, full durable
  regression suite within noise. The atomic `getSelectedConversation` stays
  registered as the rollback until a green production cycle.
