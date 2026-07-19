import type { SelectedRunProjection } from "@/convex/messages"
import { LEASE_SKEW_GRACE_MS } from "@/convex/domain/generation_run_liveness"

/**
 * Run presentation — the ONE pure resolver of local/background/stale
 * generation state (durable-turn gameplan §8). Every surface (assistant row,
 * Activity panel, composer Stop, announcer, action suppression) presents this
 * value; none re-derives its own local/background/stale booleans.
 *
 * This is the ONLY place time-based classification may live (§18 #3): the
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
  /** Convex socket connectivity — presentation only, never lifecycle truth. */
  isConnected: boolean
  /** Injected clock (ms). */
  now: number
  /** Clock-skew grace; defaults to the shared constant. */
  skewGraceMs?: number
}

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
    selectedRun,
    pendingStopRunId,
    isConnected,
    now,
  } = inputs
  const skewGraceMs = inputs.skewGraceMs ?? LEASE_SKEW_GRACE_MS

  const localLive = localStatus === "submitted" || localStatus === "streaming"
  const localMatchesRun =
    selectedRun !== null &&
    localAssistantMessageId !== null &&
    selectedRun.assistantMessageId === localAssistantMessageId

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
      (approval.expiresAt === undefined || now < approval.expiresAt + skewGraceMs)
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
    pendingStopRunId !== null &&
    (selectedRun === null || selectedRun.runId === pendingStopRunId)
  ) {
    return {
      state: "stopping",
      source: localMatchesRun || selectedRun === null ? "local" : "background",
      active: true,
      stoppable: false,
      stopTargetRunId: pendingStopRunId,
      caretEligible: false,
      actionsSuppressed: true,
      // The local transport is cut promptly while the mutation settles.
      shouldStopLocalStream: localLive,
      terminalReason: undefined,
    }
  }

  // 4. Matching local attached stream — and local submission before the run
  //    is even reflected (prepare not yet observed): local truth renders
  //    immediately without waiting for a heartbeat.
  if (localLive && (localMatchesRun || selectedRun === null)) {
    return {
      state: localStatus === "submitted" ? "local-submitted" : "local-streaming",
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
    const orphanedLocalStream =
      localStatus === "streaming" &&
      localAssistantMessageId !== null &&
      !localMatchesRun
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
