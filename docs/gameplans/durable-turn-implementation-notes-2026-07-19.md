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
4. **Post-Stop 401 write storm.** The first grant rejection on a worker
   write records authority loss, aborts provider consumption, and
   short-circuits every later write locally
   (`durable_worker_authority_revoked`, warned once). Live-verified: a Stop
   produced ONE discovering 401 in Convex logs (previously 5–7, including
   the abort write). Grant EXPIRY stays a degraded receipt — the run is not
   known settled there. (Round 2 corrected the claim's scope: writes already
   in flight at discovery can still each reject once, and round 2 extended
   discovery to the approval/tool-record/failure write paths.)
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

## Second review round (2026-07-19, post-fix commit)

A follow-up review of the fix commit confirmed the text-only reload headline
and the pause/stripping fixes, and found seven real residuals — all addressed
in the second fix commit:

1. **Stop-before-projection was a silent no-op** (the worst residual: with
   durable turns detached from `req.signal`, cutting the local transport
   stops nothing). `handleStop` now arms a DEFERRED stop intent when no run
   id is known; an effect fires the mutation at the exact run id the
   projection delivers (still run-scoped, never "the active run"), disarming
   on terminal projections, chat switches, or a 30 s timeout.
2. **The local write gate could resolve a skip that read as a landed
   terminal.** `writeTerminal` re-checks authority/expiry every retry
   iteration and identity-checks the skip sentinel; expiry discovered
   mid-settlement now degrades (nothing is known settled) instead of
   confirming.
3. **A failed armed continuation dispatch stranded the approval** (consumed
   ids were the only authorization; the SDK never re-evaluates on error and
   the reaper only expires PENDING approvals). The armed ids are stashed per
   binding and RESTORED on dispatch error — a reload then recovers the
   continuation; a finished dispatch stays consumed.
4. **Not every write path discovered revocation.** Approval-request,
   tool-invocation, stream-error, and fail() writes now note grant
   rejections too. Claim corrected: the gate stops NEW writes after the
   first discovery — writes already in flight can still each reject once.
5. **`after()` could dispose MCP clients / flush analytics while a reloaded
   worker was still executing tool steps.** Request-scoped teardown is now
   settlement-owned (`disposeTurnResources` from envelope-onEnd and fail());
   the `after()` registration remains only as a backstop for never-started
   or already-settled turns.
6. **The orphan-grace clock keyed on a live/idle boolean** — a
   streaming→submitted commit inherited the previous stream's start time.
   It now resets on every entry into `submitted` (each dispatch passes
   through it).
7. **Composer Stop for `possibly-stale`/`awaiting-approval`** — previously
   "accepted as polish", rejected by both reviews against §8/§11: the
   composer now takes the resolver's `stoppable` verdict directly, so those
   states present Stop (which the lifecycle's `stop` rule accepts on
   `awaiting_approval`).

Plus the bounded-settlement cleanups: the approval-wait race cancels its
losing timer, and `fail()` writes first (bounded ≤10 s) with the heartbeat
stopped in `finally` — the lease outlives the write, so a reaper tick cannot
relabel a provider failure `lease_expired`.

## Third review round (2026-07-19, whole-branch black-box test)

An independent whole-branch test pass (live browser + Convex state + three
adversarial probe reviewers) confirmed the durable core and found two gating
defects in this branch's own Stop/continuation orchestration — both fixed:

1. **A late approval continuation could resurrect a user-stopped run.** The
   continuation branch of `prepareGenerationForChat` enforced only the
   `continuationRunId` idempotency half. It now also requires the pause to
   have been LIVE when the prepare began — `applyApprovalResponses` stamps
   `pausedRunWasLive` when its own `approvals-resolved` close transitioned
   the run in this transaction; a pause settled earlier (Stop, supersession,
   reap) throws the structured continuation conflict, rolling back the whole
   transaction (approval repaints included). A belt-and-suspenders slot
   check also conflicts a pause that no longer owns `chat.statusRunId`, so
   a delayed continuation can never supersede-sweep a healthy newer run.
2. **The deferred Stop disarmed against the PREVIOUS turn's terminal run.**
   In any chat with history, `selectedRun` at arm time is the prior turn's
   completed run; the disarm-on-terminal branch fired immediately and the
   worker streamed on. The intent now pins the arm-time run id and waits
   through it — it fires (or disarms) only when a NEW run id arrives.

Round-3 should-fixes also landed: the "stopping" presentation cuts only a
stream whose identity matches the stopped run (a new turn dispatched during
the Stop mutation is no longer demoted to snapshot cadence); the provider
deadline is anchored at turn construction so a slow prepare (MCP connects,
attachments) erodes the provider window, not the settlement reserve (with a
15 s floor); an unparseable heartbeat 200 body is transport trouble with the
bounded retry budget — only an explicit `lost` verdict aborts a healthy
generation (and the failure counter resets only on recognized bodies); and
the non-owner selected-conversation read applies the same
`awaiting_approval` message filter as the public share read.

**Round-3 items deferred, deliberately (recorded, not forgotten):**

- A pause whose approvals are all resolved but whose continuation never
  dispatched (tab crash before auto-send) has no reaper rule: no lease, no
  pending approval. Bounded harm — the slot transfers on the next send, and
  the composer now offers Stop on the stale pause — but "everything
  converges" needs a dedicated resolved-without-continuation reaper pass.
- `supersededByRunId` is schema+gameplan vocabulary with no writer.
- Tool-invocation writes rely on the terminal-run guard alone (no per-tool
  monotonic sequence); the dangerous windows close with the continuation
  conflict above.
- One unreproduced cold-tab anomaly (a tab mid-Stop at load rendered the
  next run only at terminal, 1 of 3 trials) — watch cold-mount adoption
  timing.
- `onFinish` clears armed continuation ids on abort finishes too: correct
  when the Stop settled the pause (nothing left to continue), and a
  restored-then-conflicted redispatch would be noise.

## Fourth review round (2026-07-19, standards + spec)

Fixed:

- **Structural auth for the new surfaces** (CONTEXT.md "Authenticated
  handler"): `getSelectedConversation` moved onto `readableChatQuery`
  (auth-free `getSelectedConversationForViewer` core takes the injected
  chat/viewer), and `stopGenerationRun` moved onto
  `ownedGenerationRunMutation` — the chat is derived THROUGH the run, so the
  old hand-written `run.chatId` cross-check (and the client's `chatId` arg)
  is gone; the mutation takes `runId` alone.
- **The previous turn's terminal no longer suppresses a new dispatch's
  presentation** (§8): a terminal projection behind a live NON-matching local
  dispatch is masked — local-submitted/local-streaming render immediately
  with Stop (deferred intent when the run id is unknown). A terminal for the
  local stream's OWN run is never masked (remote-Stop convergence intact).
- **Approval expiry is transactional**: `resolveToolCallDecision` compares
  `expiresAt` against the server clock inside the mutation and settles the
  row `expired` — a decision racing in after expiry can no longer approve
  expired work regardless of reaper cadence.
- **Losing approval clicks render the canonical decision fully**: the
  mutation returns the persisted `reason`, and the client applies it instead
  of the losing tab's local input.

Refuted (with evidence): the "activated `no-use-effect` rule" cited against
`use-chat-core.ts`/`sidebar-chat-status.ts` does not exist — the repo's
eslint config restricts icons, `interface`, inline `ctx.auth`, and raw
`useQuery` imports only, and neither CONTEXT.md nor AGENTS.md bans effects
(the same file carries twelve pre-dating effects). No refactor performed.

Accepted deviation: the §16 presentation rollout flag + 15-flow manual gate
was NOT built. The plan's own settled list ("compatibility machinery stays
collapsed per the pre-launch disposable-database policy; the browser/E2E
harness is optional follow-on, never a rollout gate") plus the pre-launch
posture make a dual presentation path pure risk: the legacy path no longer
exists to fall back to, and a flag guarding an unlaunched app's only surface
gates nothing. Revisit if a production rollout needs staged exposure.

**Reviewed and accepted as-is (not defects, or deliberate polish gaps):**

- A worker-write timeout does not cancel the underlying fetch, so a late
  heartbeat can still renew the lease — that renewal is truthful (the worker
  IS alive; settle terminalizes regardless), so no cancellation plumbing.
- On Stop, the tail between the last accepted snapshot and the Stop click is
  deliberately dropped: the Stop terminal freezes content, and the worker's
  later flush is absorbed as settled-elsewhere. First-terminal-wins applies
  to content too.
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
