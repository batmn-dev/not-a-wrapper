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

## Fifth review remediation (2026-07-20)

The fourth-round conclusions about effects and the presentation flag are
superseded for this branch by the explicit follow-up review standard:

- **Presentation ownership was consolidated.** The newly introduced
  transport-clock mirror, presentation interval, terminal-to-local-Stop relay,
  deferred-Stop relay/timeout, and sidebar-expiry timer no longer live as
  independent `useEffect` choreography. A focused generation-presentation
  controller owns local dispatch identity and exact deferred Stop state;
  dispatch time is emitted by the Chat turn controller at the actual SDK
  dispatch boundary. Wall-clock updates and deadlines use external-store
  subscriptions. One purpose-built layout synchronization is retained for the
  genuine external convergence boundary: a Convex projection can satisfy a
  deferred Stop or terminalize a locally attached transport independently of a
  user event.
- **The presentation rollout boundary now exists.**
  `NEXT_PUBLIC_ENABLE_DURABLE_RUN_PRESENTATION=true` enables unmatched
  background/stale/returning-client presentation. It is OFF by default until
  the §14 fifteen-flow checklist passes. Backend leases, reapers, snapshots,
  approval expiry, atomic projection, and run-owned Stop remain active while
  the flag is off. The independently accepted default-on paginated-sidebar flag
  (ADR-0005) is unchanged.
- **Approval expiry now has one transactional owner.** Decision-time expiry and
  the approval reaper call the same operation, settling the approval, linked
  Tool invocation, paused run, Assistant message, and chat projection in either
  commit order. The exact boundary is `now >= expiresAt` for both paths.
- **Canonical losing-click feedback is complete.** The client applies the
  stored winning status and reason and displays the required “Already resolved”
  informational feedback. Tests cover approve-first and deny-first races with
  different reasons.
- **The projection-gap Stop regression reaches the real Composer control.** A
  submitted turn in a chat with a previous terminal run renders Stop; clicking
  the actual primary action reaches the deferred exact-run path, which waits
  for a new projection identity rather than inferring the last run in the chat.

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

## §14 fifteen-flow checklist executed; presentation made unconditional (2026-07-27, follows the decision below)

The fifteen browser flows ran locally through the signed-in browser against the
dev deployment with the presentation seam forced on. After the fixes below, the
flag, its disabled path, `lib/flags.ts`, the flag-only tests
(`lib/flags.test.ts`, the resolver's flag-off case, the sidebar rollout case,
both `vi.mock("@/lib/flags")` shims), and the `durablePresentationEnabled`
parameters were removed; the resolver and its behavioral coverage are intact
and presentation is unconditional. A post-removal smoke (reload mid-stream on
a GPT-5 Mini run) confirmed the returning client presents the background run.

**Flow results.** Passed live with Convex data checks: navigate-away/return
mid-text (projection ring while away; partial text + Stop on return; snapshot
sequence growth), reload mid-text (same run id, content restored), reload
during reasoning/approval (activity + approval controls restored; content tail
preserved; pause had lease cleared, 24 h approval expiry mirrored to
`liveRunFreshUntil`), reload during tool (five parallel approved DeepWiki
calls; reloaded client showed the running tool from durable evidence), second
tab (identical presentation), Stop from tab two (`aborted/user_stop`,
lease+grant cleared, tab one's stream cut), simultaneous Stop (one terminal
transition, no error loop), worker death (grant revoked + lease back-dated via
a temporary probe mutation — deleted afterward — because killing the user's
long-running dev server was off-limits; reaper settled `failed/lease_expired`
with partial content preserved and a Retry affordance), complete during
hydration (no zombie loader; `completed/completed`), two-tab approve (loser
rendered "Already resolved — decided in another tab", exactly one
continuation), terminal zombie sweep (zero active-looking runs, zero live chat
projections, no sidebar spinner). The §5 one-off legacy settle also ran: six
pre-lease `streaming` rows (and one chat with a null-deadline `liveRunStatus`
that rendered an indefinite spinner) were lease-back-dated and settled
`failed/lease_expired` by the production reaper.

**Dispositions rather than live passes.** Reload-before-first-token: the
window is sub-second with current providers; the contract is pinned by the
resolver/React "remount before first content" coverage and evidenced by the
no-text background presentations above. Newer generation: the composer
deliberately gates sends while any run is active (Stop is the primary action,
Enter does not dispatch — verified live), so prepare-level supersession has no
UI trigger; it remains covered by the Convex supersession suite. Convex
disconnection: an offline toggle could not be simulated through the browser
harness (WebSocket sabotage attempts never tripped the client); disconnected
presentation stays pinned by the resolver's `isConnected` coverage.

**Checklist failures found and fixed (all one root cause, three sites):** the
presentation fold and the chat API recognized only STATIC tool parts
(`tool-*`), but every MCP tool — the only runtime-approval source in
production — streams and persists as `dynamic-tool`:

1. `lib/chat-messages/turn-evidence.ts` (plus `parts.ts`, `sources.ts`,
   `assistant-turn.ts`) skipped dynamic parts, so an MCP tool produced no
   activity entries: no disclosure trigger, therefore NO reachable
   Approve/Deny — live and after reload. The evidence walk now accepts both
   shapes through a single widened seam (`ToolEvidenceUIPart`,
   `isToolEvidencePart`, `getToolEvidenceName`), which also fixes the tool
   render signature (dynamic state changes now re-render memoized rows).
2. The SDK's approval-continuation auto-send dispatches with no per-call body,
   so the continuation POST had no `chatId`/`model` and 400'd. The transport
   (`AcceptanceAwareChatTransport`) now merges a fallback turn body — built by
   `buildChatTurnRequestBody` from call-time Turn-context reads — under any
   per-call body whenever a dispatch carries no `chatId`; runner sends are
   untouched.
3. `extractApprovalResponses`/`hasApprovalResponse`/`countToolParts` in the
   durable runtime were also static-only, so an MCP continuation classified as
   a fresh send ("Selected path token required"). Widened to both shapes; and
   the history adaptation in `chat-turn-runtime.ts` now exempts the live
   continuation tail (the trailing assistant message with approval-responded
   parts) — the replay compilers summarize non-replayable tool exchanges away,
   which had stripped the very tool call being continued and left a
   thinking-final assistant message Anthropic rejects
   ("The final block in an assistant message cannot be `thinking`").

After the three fixes the full chain verified live: approve → continuation
prepare (pause closed `completed`, `continuationRunId`/`continuedFromRunId`
linked) → tool executed → answer streamed → `completed/completed`, invocation
`approved`, projection cleared.

**Cold-tab adoption anomaly: resolved by verification.** Three post-fix trials
of the recorded scenario (tab cold-loaded during a Stop, next run dispatched
immediately) all presented the new run promptly — streaming content and Stop
within one projection tick, never only-at-terminal. No adoption-semantics
change was made; the 2026-07-19 single-trial observation is attributed to the
now-fixed defect cluster or a transient, and the TODO entry is closed.

**Confirmed live, still deferred (existing TODO):** an `awaiting_approval`
pause whose approval was resolved but whose continuation never dispatched has
no automatic recovery — clicking Approve again returns `alreadyResolved`
without re-arming auto-send. The composer's Stop settles it manually; the
dedicated reaper rule remains the recorded follow-up.

**Operational note:** the checklist's Opus 4.8 runs exhausted the platform
Anthropic account's credits near the end of the session (subsequent Anthropic
turns fail with an actionable "insufficient credits" banner — itself correct
failure presentation). Later verification switched to GPT-5 Mini; future live
smokes should use cheap models from the start.

## Presentation decision update (2026-07-27)

This section supersedes the fifth-review presentation rollout boundary and the
older flag-based rollout instructions in the gameplan.

- An authenticated local smoke test with the flag OFF confirmed that durable
  snapshots continue across navigation, reload, and a second tab, but returning
  clients show neither active-generation presentation nor a Stop control.
- The existing `NEXT_PUBLIC_ENABLE_DURABLE_RUN_PRESENTATION` seam is now only a
  temporary way to exercise the implemented behavior while running the
  gameplan's fifteen local browser flows.
- After those flows pass and any defect is fixed, remove the flag, the disabled
  path, and flag-only tests. The verified durable presentation becomes the only
  product path.
- Do not run a flag-off/flag-on deployment progression or retain the flag for a
  soak. Rollback is `git revert` plus redeploy, which has the same deployment
  latency without permanently maintaining two presentation behaviors.

## Resolved-approvals-without-continuation reaper (2026-07-27)

Closes the third-round deferred item ("everything converges" needed a
dedicated resolved-without-continuation pass) and the matching TODO entry.
The stranded shape: an `awaiting_approval` run whose approvals are all
resolved but whose continuation prepare never ran (client crashed or reloaded
before auto-send, or a historical strand). It held no lease (the pause sheds
it) and no pending approval, so neither existing reaper matched; deny-pending
only touches pending rows and the supersede sweep never reaches a pause, so
next-turn convergence left it awaiting forever, and a second Approve click
returned `alreadyResolved` without re-arming auto-send.

**What landed:**

- Lifecycle signal `continuation-lost` (with `anyDenied`, mirroring
  `approvals-resolved`): legal ONLY from `awaiting_approval` — every other
  status ignores (`not-awaiting-approval` / `already-terminal`), so the signal
  structurally cannot resurrect a Stop-settled, superseded, or
  already-continued run. Denied strands close `aborted`; approved strands
  close `failed` (the tool never executed — `completed` would lie). Both stamp
  the new terminal reason `continuation_lost` (schema union extended) and
  error `approval continuation was not dispatched`.
- `reapResolvedApprovalPausesPass` in `convex/chatRuntime.ts`, registered in
  `convex/crons.ts` every minute, bounded by `REAPER_BATCH_LIMIT` over the
  `by_status` index at `awaiting_approval`.

**Exact boundary conditions (all checked transactionally per candidate):**

1. Re-read run still `awaiting_approval`; `continuationRunId` undefined (a
   stamped continuation means a prepare owns the close — unreachable while
   paused, but never fought).
2. Chat exists and is active (tombstoned logical roots skipped, like the
   other reapers).
3. ≥ 1 approval row for the run (prefix read on `by_run_status`); NONE
   pending — a pending row means the user or the approval reaper still owns
   the pause.
4. Every resolved row carries a defined `resolvedAt`, and
   `now >= latest(resolvedAt) + RESOLVED_APPROVAL_CONTINUATION_GRACE_MS`
   (5 min, in `generation_run_liveness.ts`). The boundary instant itself is
   eligible. An UNDATED resolution excludes the candidate — the §18 #6
   `undefined` rule applied to this pass's expiry comparison: `undefined`
   must never classify as "old enough" (fail-closed, unit-pinned).
5. Settlement reuses the shared machinery: `gatherAssistantMessageFacts` +
   `applyLifecycleVerdict` (partial content preserved / stub policy) +
   `settleAuxiliaryRecordsForTerminalRun` (never-executed invocations →
   `failed`; approval rows keep their canonical approved/denied decision).
   The chat projection stays `statusRunId`-guarded, so a pause whose slot
   already transferred to a next send cannot clear the newer run's status.

**Race posture (both commit orders unit-tested):** reaper-first → the late
auto-send continuation hits the existing `pausedRunWasLive` typed conflict
("Approval pause already settled") and rolls back; continuation-first → the
pause is no longer `awaiting_approval`, the pass no-ops, continuation and
`continuationRunId` linkage intact. The grace window is measured from the
LAST `resolvedAt`, so the live approve → auto-send path (verified end-to-end
2026-07-27) is never raced; the minute cadence only bounds detection latency.

**Live evidence (dev `polite-jackal-630`, 2026-07-27):** a real DeepWiki
`ask_question` pause (run `js7eskr53c6xjpsrg6jgawrzts8bbm7g`, chat
`jh7daw47ehravh8cgyqdbc9arn8bbft2`) was stranded via a temporary probe
mutation that resolved the pending approval with a `resolvedAt` backdated
past the grace (probe deleted and deployment re-pushed afterward). The next
cron tick logged `run_stale_reaped / continuation_lost` (ageMs ≈ 376 s) and
settled: run `failed`/`continuation_lost` with `completedAt`, invocation
`failed` ("approval continuation was not dispatched"), approval row kept
`approved`, message stamped `failed` with all parts preserved, chat
projection cleared (`liveRunStatus`/`liveRunFreshUntil` gone,
`lastRunStatus: failed`, `statusRunId` kept). Deployment-wide scan after:
zero queued/running/streaming/awaiting runs, zero pending approvals, zero
chats with a live projection. UI renders the honest inline failure with
Retry and a live composer.

**Review round (2026-07-27, whole-diff):** three findings addressed, one
partially refuted.

1. *Reaper scan starvation (fixed):* candidate selection now scans
   `RESOLVED_PAUSE_SCAN_LIMIT` (8× the settle budget) `awaiting_approval`
   rows per tick while settling at most `REAPER_BATCH_LIMIT` — unlike the
   lease/approval reapers, this pass's eligibility is only decidable per
   candidate, so ineligible pauses legitimately occupy the `by_status`
   prefix and a settle-budget-sized scan could curtain off eligible strands
   forever. A persistently full window logs
   `resolved_pause_scan_saturated` (no silent caps). Regression test: 30
   ineligible pauses ahead of one eligible strand still settle it. Also
   added the multi-approval grace test (the LAST `resolvedAt` gates the
   pause).
2. *OpenAI plaintext replay fallback flattened the continuation tail
   (fixed):* the fallback now plaintexts only the adapted HISTORY; the live
   continuation tail keeps its full parts (the approval-responded tool call
   the SDK executes this turn) with provider-linked metadata stripped via
   `stripProviderLinkedMetadataFromMessage` (app/api/chat/utils.ts, unit
   tested) so pairing ids cannot ride back in. The fallback warn logs
   `continuationTailPreserved`.
3. *Auto-send fallback body vs. wire contract (partially refuted, link
   restored):* assembly was already through the controller's
   `buildChatTurnRequestBody` — the Chat turn wire contract seam — so no
   ownership move was needed; what was real is that the transport plumbing
   erased the type to `Record<string, unknown>`. The fallback provider is
   now typed `() => ChatTurnBodyFields | null` end-to-end, restoring the
   compile-time contract link.

CONTEXT.md's Generation run lifecycle entry now lists the full signal
vocabulary (stop / lease-expired / approval-expired / continuation-lost
included).
