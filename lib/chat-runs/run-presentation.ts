import { LEASE_SKEW_GRACE_MS } from "@/convex/domain/generation_run_liveness"
import type { SelectedRunProjection } from "@/convex/messages"

/**
 * Run presentation — the one pure resolver of local/background/stale
 * generation state. Every surface (assistant row,
 * Activity panel, composer Stop, announcer, action suppression) presents this
 * value; none re-derives its own local/background/stale booleans.
 *
 * This is the only place time-based classification may live: the
 * server stores `leaseExpiresAt` / approval `expiresAt`; this module compares
 * them to an injected clock with a skew grace. Convex queries cannot do this —
 * they re-execute on data changes, never on wall-clock time.
 *
 * Guest/local chats pass `selectedRun: null` and reduce exactly to the
 * pre-durable local-only behavior.
 */

export type LocalTransportStatus = "streaming" | "ready" | "submitted" | "error"

export type GenerationPresentationState =
  | "local-submitted"
  | "local-streaming"
  | "background-streaming"
  | "awaiting-approval"
  | "stopping"
  | "possibly-stale"
  | "completed"
  | "stopped"
  | "failed"
  | "superseded"
  | "settled"

export type GenerationPresentation = {
  state: GenerationPresentationState
  /** Which execution evidence drives visuals. */
  source: "local" | "background" | "none"
  /** Any live phase (drives loaders, action suppression, scroll pinning). */
  active: boolean
  /** The composer's primary action should be Stop (resolver output — never a
   * projection field). */
  stoppable: boolean
  /** The exact run a durable Stop must target; null before the run exists. */
  stopTargetRunId: string | null
  /** Caret may render (fresh local/background responding with content). */
  caretEligible: boolean
  /** Edit/regenerate/branch/footer actions are suppressed. */
  actionsSuppressed: boolean
  /**
   * Resolver-mandated side effect: the durable truth settled (or a Stop is
   * pending) while this client's transport still streams — cut it via local
   * `stop()`. Convergence must not wait for the worker to notice (§18/§8).
   */
  shouldStopLocalStream: boolean
  /** Terminal vocabulary for banners; undefined while live. */
  terminalReason?: SelectedRunProjection["terminalReason"]
}

export type RunPresentationInputs = {
  /** AI SDK transport status of this client's stream. */
  localStatus: LocalTransportStatus
  /** Composer submit in flight (pre-transport). */
  isSubmitting: boolean
  /**
   * The assistant message id this client's live stream writes into (durable
   * runs stream the durable assistantMessageId as the message identity), or
   * null when nothing was locally dispatched. The local/run match is by this
   * id — never "last run in chat".
   */
  localAssistantMessageId: string | null
  /** Raw durable facts from the atomic projection; null for guests/non-owners. */
  selectedRun: SelectedRunProjection | null
  /** Run id of a durable Stop mutation currently in flight, if any. */
  pendingStopRunId: string | null
  /** A user Stop is armed for the local dispatch, but its explicit durable run
   * identity has not arrived yet. */
  deferredStopPending?: boolean
  /** Convex socket connectivity — presentation only, never lifecycle truth. */
  isConnected: boolean
  /**
   * When this client's live stream entered submitted/streaming (ms), or null
   * when nothing is locally live. Guards the orphan cut below: right after a
   * regeneration dispatch, the projection can still show the PREVIOUS run for
   * a beat — the new local stream must not be cut as "orphaned" during that
   * identity gap.
   */
  localStreamStartedAtMs?: number | null
  /** Injected clock (ms). */
  now: number
  /** Clock-skew grace; defaults to the shared constant. */
  skewGraceMs?: number
}

/**
 * How long a live local stream is protected from the supersession cut while
 * the selected-run projection catches up to its own dispatch (regeneration
 * identity gap). A genuinely superseded stream older than this still cuts;
 * younger ones are also ended server-side by the superseding prepare (grant
 * revocation → provider abort), so nothing streams on unbounded.
 */
export const ORPHAN_STREAM_CUT_GRACE_MS = 15_000

const TERMINAL_RUN_STATUSES = new Set(["completed", "aborted", "failed"])

function terminalState(
  run: SelectedRunProjection
): Extract<
  GenerationPresentationState,
  "completed" | "stopped" | "failed" | "superseded"
> {
  if (run.status === "completed") return "completed"
  if (run.status === "failed") return "failed"
  // aborted: a user Stop reads as stopped; a supersession as superseded.
  return run.terminalReason === "superseded" ? "superseded" : "stopped"
}

/** Resolve the one presentation every surface renders. Pure; injected clock. */
export function resolveGenerationPresentation(
  inputs: RunPresentationInputs
): GenerationPresentation {
  const {
    localStatus,
    isSubmitting,
    localAssistantMessageId,
    pendingStopRunId,
    isConnected,
    now,
  } = inputs
  const deferredStopPending = inputs.deferredStopPending ?? false
  const skewGraceMs = inputs.skewGraceMs ?? LEASE_SKEW_GRACE_MS

  const rawSelectedRun = inputs.selectedRun
  const localLive = localStatus === "submitted" || localStatus === "streaming"
  const localMatchesRun =
    rawSelectedRun !== null &&
    localAssistantMessageId !== null &&
    rawSelectedRun.assistantMessageId === localAssistantMessageId

  // A TERMINAL projection behind a NEW local dispatch is the PREVIOUS turn's
  // run — presentation-irrelevant to the in-flight submission:
  // local submission renders immediately, Stop included). Without masking it,
  // rule 1 below would win for the whole projection gap in any chat with
  // history: the composer would show the prior turn's settled state and offer
  // no Stop while the new dispatch streams. A terminal for OUR OWN stream
  // (localMatchesRun) is never masked — that is the remote-Stop convergence.
  const selectedRunMasked =
    rawSelectedRun !== null &&
    TERMINAL_RUN_STATUSES.has(rawSelectedRun.status) &&
    (localLive || isSubmitting) &&
    !localMatchesRun
  const selectedRun = selectedRunMasked ? null : rawSelectedRun

  const settledBase = (
    state: Extract<
      GenerationPresentationState,
      "completed" | "stopped" | "failed" | "superseded" | "settled"
    >,
    terminalReason?: SelectedRunProjection["terminalReason"]
  ): GenerationPresentation => ({
    state,
    source: "none",
    active: false,
    stoppable: false,
    stopTargetRunId: null,
    caretEligible: false,
    actionsSuppressed: false,
    // Cut a still-streaming local transport when the durable outcome for OUR
    // run settled remotely (remote Stop, supersession, reap).
    shouldStopLocalStream: localLive && localMatchesRun,
    terminalReason,
  })

  // 1. Durable terminal result wins — including during hydration.
  if (selectedRun && TERMINAL_RUN_STATUSES.has(selectedRun.status)) {
    return settledBase(terminalState(selectedRun), selectedRun.terminalReason)
  }

  // 2. Durable pending approval.
  if (selectedRun && selectedRun.status === "awaiting_approval") {
    const approval = selectedRun.pendingApproval
    const unexpired =
      approval !== null &&
      (approval.expiresAt === undefined ||
        now < approval.expiresAt + skewGraceMs)
    if (unexpired) {
      return {
        state: "awaiting-approval",
        source: localMatchesRun ? "local" : "background",
        active: true,
        stoppable: true,
        stopTargetRunId: selectedRun.runId,
        caretEligible: false,
        actionsSuppressed: true,
        shouldStopLocalStream: false,
        terminalReason: undefined,
      }
    }
    // Expired (or vanished) approval: the reaper settles it durably; until
    // then the pause is stale, not actionable.
    return {
      state: "possibly-stale",
      source: "background",
      active: false,
      stoppable: isConnected,
      stopTargetRunId: selectedRun.runId,
      caretEligible: false,
      actionsSuppressed: true,
      shouldStopLocalStream: false,
      terminalReason: undefined,
    }
  }

  // 3. Locally pending durable Stop.
  if (
    deferredStopPending ||
    (pendingStopRunId !== null &&
      (selectedRun === null || selectedRun.runId === pendingStopRunId))
  ) {
    return {
      state: "stopping",
      source: localMatchesRun || selectedRun === null ? "local" : "background",
      active: true,
      stoppable: false,
      stopTargetRunId: pendingStopRunId,
      caretEligible: false,
      actionsSuppressed: true,
      // Cut only a stream KNOWN to belong to the run being stopped: a new
      // turn dispatched while the Stop mutation is in flight is a different
      // stream and must not be demoted to snapshot-cadence rendering. The
      // stopping tab's own stream was already cut directly by handleStop.
      shouldStopLocalStream: localLive && localMatchesRun,
      terminalReason: undefined,
    }
  }

  // 4. Matching local attached stream — and local submission before the run
  //    is even reflected (prepare not yet observed): local truth renders
  //    immediately without waiting for a heartbeat.
  if (localLive && (localMatchesRun || selectedRun === null)) {
    return {
      state:
        localStatus === "submitted" ? "local-submitted" : "local-streaming",
      source: "local",
      active: true,
      stoppable: true,
      stopTargetRunId: selectedRun?.runId ?? null,
      caretEligible: localStatus === "streaming",
      actionsSuppressed: true,
      shouldStopLocalStream: false,
      terminalReason: undefined,
    }
  }
  if (isSubmitting && selectedRun === null) {
    return {
      state: "local-submitted",
      source: "local",
      active: true,
      stoppable: false,
      stopTargetRunId: null,
      caretEligible: false,
      actionsSuppressed: true,
      shouldStopLocalStream: false,
      terminalReason: undefined,
    }
  }

  // 5. Fresh durable background run (client-classified freshness). A live
  //    local stream whose KNOWN identity does not match the selected run lost
  //    the chat slot to a newer run (supersession) — cut it; its own run's
  //    terminal is no longer visible through this projection.
  if (selectedRun) {
    const localStreamStartedAtMs = inputs.localStreamStartedAtMs ?? null
    // The identity mismatch is only trustworthy once the projection has had
    // time to reflect this client's own dispatch (see the input's doc) — a
    // null start time means the caller can't vouch for the stream's age, so
    // never cut on its behalf.
    const orphanGraceElapsed =
      localStreamStartedAtMs !== null &&
      now - localStreamStartedAtMs >= ORPHAN_STREAM_CUT_GRACE_MS
    const orphanedLocalStream =
      localStatus === "streaming" &&
      localAssistantMessageId !== null &&
      !localMatchesRun &&
      orphanGraceElapsed
    const fresh =
      selectedRun.leaseExpiresAt !== undefined &&
      now < selectedRun.leaseExpiresAt + skewGraceMs
    if (fresh && isConnected) {
      return {
        state: "background-streaming",
        source: "background",
        active: true,
        stoppable: true,
        stopTargetRunId: selectedRun.runId,
        caretEligible: true,
        actionsSuppressed: true,
        shouldStopLocalStream: orphanedLocalStream,
        terminalReason: undefined,
      }
    }
    // 6. Expired or unverifiable active-looking run: preserve content, no
    //    live animation; Stop stays available online for the exact run.
    return {
      state: "possibly-stale",
      source: "background",
      active: false,
      stoppable: isConnected,
      stopTargetRunId: selectedRun.runId,
      caretEligible: false,
      actionsSuppressed: true,
      shouldStopLocalStream: orphanedLocalStream,
      terminalReason: undefined,
    }
  }

  // 7. Settled — no current linked run, no local activity.
  return settledBase("settled")
}
