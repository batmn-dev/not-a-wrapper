# Durable-turn implementation notes — 2026-07-19

Companion record to
[extend-the-existing-convex-native-durable-turn-architecture.md](./extend-the-existing-convex-native-durable-turn-architecture.md)
(the plan file has unrelated local edits in flight, so accepted deviations are
recorded here instead of inline in its §0 addendum). PRs 0–8 landed on
`darknight/otisburg`; PR 9 (E2E harness) was out of scope as specified.

## Accepted deviations / clarifications

1. **Grant revocation required a wire-side complement (PR 0).** Clearing
   `grantDigest` on absorbing outcomes turns the previously-benign
   double-terminal writes (envelope abort after stream abort; spurious
   completion after a landed failure) into grant rejections at the endpoint
   instead of in-handler lifecycle no-ops. Unhandled, every user Stop would
   have produced a false `durable_settlement_degraded`. The worker wire now
   surfaces typed grant rejections (`DurableWorkerWriteError`), and
   `writeTerminal` absorbs `grant_unauthorized` as idempotent settlement
   (`durable_terminal_write_rejected_settled`, no retries) and treats
   `grant_expired` as non-retryable. Same semantics as before revocation,
   different door.

2. **The §19 "does the SDK evaluate `sendAutomaticallyWhen` on hydration?"
   question was made moot instead of pinned (PR 8).** The layer-3 client gate
   requires a LOCALLY-resolved approval id before auto-send can arm, so
   adopted approval-responded parts cannot dispatch regardless of the SDK's
   hydration behavior — this is the plan's own "strip/normalize" fallback,
   implemented as a gate.

3. **`approvals-resolved` with a denial carries no `terminalReason`** — no
   member of the §5 union describes "user denied the approval", and inventing
   vocabulary was worse than an optional field (documented in the lifecycle
   module).

4. **Background/stale presentation rides an effective transport status
   (PR 5).** The resolver is authoritative; a client-classified FRESH
   background run renders as streaming through the existing row/panel/
   announcer pipeline. Dedicated §11 copy ("Generating in background",
   "Checking generation status"), the offline run-scoped Stop intent queue,
   activity timer-freeze wording, and dedicated announcer strings are
   remaining polish on top of the landed resolver — the durable-correctness
   invariants (no zombie loader anywhere, terminal cuts the local stream,
   freshness-bounded sidebar) are complete and tested.

5. **Provider-deadline enforcement landed with PR 2**, composed as
   `AbortSignal.any([request, worker-loss, AbortSignal.timeout(providerDeadline)])`
   in the Chat turn runtime — the addendum left the wiring point open; the
   budget module stayed the single source of the value.

## Independent review round (2026-07-19, post-PR 8)

An external senior review of the full series confirmed five real defects, all
fixed in the follow-up commit:

1. **Reload aborted the durable worker.** The provider execution signal
   composed `req.signal`, so a client disconnect settled the run
   `aborted/request_aborted` — violating gameplan §12 scenario 9 / §14. The
   runtime now exposes `providerAbortSignals(requestSignal)`: durable turns
   EXCLUDE the request signal (Stop/supersession/reaping arrive via heartbeat
   `lost`/grant rejection); guest turns keep it (nobody settles a
   disconnected guest stream). Client-abort telemetry stays on `req.signal`;
   abort CLEANUP (reasoning close, stalled-continuation disarm) moved to the
   execution signal. Live-verified: reload mid-stream → same run id →
   `completed/completed`, full answer after reload.
2. **A post-pause snapshot could repaint `awaiting_approval` back to
   `streaming` without a lease** — stranding the run outside both liveness
   regimes (no lease for the run reaper, no pending status for the approval
   reaper) if the completion downgrade never arrived.
   `updateAssistantSnapshotForChat` now advances status only while the run is
   worker-executing; on a pause it lands content/sequence/progress only.
3. **`grant_unauthorized` on a terminal write claimed the requested
   outcome.** A completion write racing a landed failure would have reported
   `confirmed/completed` over a `failed` run. `writeTerminal` is now
   three-way (`landed` / `settled-elsewhere` / `failed`) and the receipt's
   `settled-elsewhere` outcome says exactly what is known: the run is settled,
   by the revoker, with the revoker's outcome — Convex is the source of truth.
4. **Post-Stop 401 write storm.** The first grant rejection on ANY worker
   write (heartbeat, snapshot, terminal) now records authority loss, aborts
   provider consumption, and short-circuits every later write locally
   (`durable_worker_authority_revoked`, warned once). Live-verified: a Stop
   now produces exactly ONE discovering 401 in Convex logs (previously 5–7,
   including the abort write). Grant EXPIRY stays a degraded receipt — the
   run is not known settled there.
5. **Run linkage leaked to non-owner viewers through message docs.**
   `getSelectedConversation` nulled `selectedRun` but returned raw messages
   carrying `generationRunId`/`requestId`; the older `getForChat` /
   `getPublicForChat` / `getLastMessages` reads had the same exposure. All
   four now strip both fields for non-owner viewers.

Plus three hardening fixes from the same review: the supersession orphan cut
gained a local-stream-age grace (`ORPHAN_STREAM_CUT_GRACE_MS`) so a
regeneration's identity gap — projection still showing the previous run —
cannot cut the healthy new stream; the approval auto-send gate became
one-shot (ids consumed on arm, so a remount that rehydrates resolved parts
never re-dispatches); settlement's straggler waits are bounded (approval
writes race a worker-write timeout, `fail()` stops the heartbeat first and
bounds its write) and `REAPER_BATCH_LIMIT` dropped to 25 (per-run auxiliary
settlement makes oversized batches an atomic-failure starvation risk).

**Reviewed and accepted as-is (not defects, or deliberate polish gaps):**

- A worker-write timeout does not cancel the underlying fetch, so a late
  heartbeat can still renew the lease — that renewal is truthful (the worker
  IS alive; settle terminalizes regardless), so no cancellation plumbing.
- On Stop, the tail between the last accepted snapshot and the Stop click is
  deliberately dropped: the Stop terminal freezes content, and the worker's
  later flush is absorbed as settled-elsewhere. First-terminal-wins applies
  to content too.
- The composer surfaces Stop only for local/background streaming; the
  resolver's `stoppable` verdict for `possibly-stale`/`awaiting-approval` has
  no composer affordance yet — grouped with the §11 copy / offline Stop
  intent queue polish (the reaper terminalizes those runs regardless).
- A pathological settlement tail (multiple consecutive 10 s write timeouts)
  can still overrun the 30 s reserve; the receipt degrades and the reaper is
  the honest backstop — the reserve covers the common case by design.
- The client's approval-conflict swallow matches on the structured code
  string; collision risk is negligible and the route emits that code
  deliberately.

## Live verification performed

- PR 3 reaper: a seeded expired-lease streaming run on the dev deployment was
  reaped by the **cron itself** within one tick — `failed/lease_expired`,
  partial content preserved, sidebar projection cleared; probe rows and the
  probe module were removed afterward.
- Post-review round: reload-mid-stream (same run → `completed`, full answer
  rendered after reload) and Stop (aborted/`user_stop`, grant+lease cleared,
  exactly one discovering 401 in Convex logs) verified live through the
  signed-in browser against the dev deployment.
- Every Convex push (`bunx convex dev --once`) validated schema and bundling
  against the real dev deployment after each PR.
