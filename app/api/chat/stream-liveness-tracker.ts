export type ChatStreamPhase =
  "pre_first_chunk" | "post_tool_continue" | "post_first_chunk" | "unknown"

export type StreamLivenessSignal =
  "chat_client_abort" | "chat_stalled_continuation"

/** Content-free liveness facts captured with a signal (Sentry `extra`). */
export type StreamLivenessSnapshot = {
  phase: ChatStreamPhase
  elapsedMs: number
  firstReleasedChunkLatencyMs: number | null
  timeSinceLastChunkMs: number | null
  timeSinceLastProgressMs: number
  stalledThresholdMs: number
  stepCounter: number
  observedToolCalls: number
  lastStepFinishReason: string | null
  lastToolStepNumber: number | null
  lastToolNames: string[]
  awaitingPostToolContinuation: boolean
  postToolContinuationDelayMs: number | null
}

export type StreamLivenessTracker = {
  /** Provider consumption begins: the clock every elapsed figure reads from. */
  streamStarted: () => void
  /** One provider step ended. A tool-calls step arms the stall timer. */
  stepEnded: (step: {
    finishReason: string | undefined
    toolCallCount: number
    toolNames: readonly string[]
  }) => void
  /** Any chunk released downstream of the transforms: progress, and disarm. */
  chunkReleased: () => void
  /** The REQUEST signal fired: client-disconnect telemetry only. */
  requestAborted: () => void
  /**
   * The EXECUTION signal fired: the stream is actually ending. Returns true
   * the first time, before completion, so the caller runs its abort cleanup
   * exactly once.
   */
  executionAborted: () => boolean
  /** The stream ended (finish, error, or the SDK's abort callback). */
  completed: () => void
  stepCount: () => number
}

/**
 * Request-local liveness for one streamed turn: which phase the stream is
 * in and whether a diagnostic signal should fire. Owns the post-tool stall
 * timer and the ordering rule that no signal fires after the stream has
 * completed or its execution was aborted, and a stall fires at most once.
 * Pure of I/O: the caller decorates the snapshot with its own identity tags
 * and captures it. Timing anchors stay with the timing tracker (ADR-0030).
 */
export function createStreamLivenessTracker(options: {
  stalledThresholdMs: number
  onSignal: (
    signal: StreamLivenessSignal,
    snapshot: StreamLivenessSnapshot
  ) => void
  now?: () => number
}): StreamLivenessTracker {
  const { stalledThresholdMs, onSignal } = options
  const now = options.now ?? Date.now

  let streamStartMs: number | null = null
  let firstReleasedChunkLatencyMs: number | null = null
  let lastChunkAtMs: number | null = null
  let lastProgressAtMs = 0
  let stepCounter = 0
  let observedToolCalls = 0
  let sawProviderChunk = false
  let lastStepFinishReason: string | null = null
  let lastToolStepNumber: number | null = null
  let lastToolNames: string[] = []
  let awaitingPostToolContinuation = false
  let postToolContinuationArmedAtMs: number | null = null
  let stalledTimer: ReturnType<typeof setTimeout> | null = null
  let stalledCaptured = false
  let clientAbortCaptured = false
  let executionAbortCaptured = false
  let completed = false

  const phase = (): ChatStreamPhase => {
    if (awaitingPostToolContinuation) return "post_tool_continue"
    if (sawProviderChunk) return "post_first_chunk"
    if (stepCounter > 0 || observedToolCalls > 0) return "unknown"
    return "pre_first_chunk"
  }

  const snapshot = (phaseOverride?: ChatStreamPhase): StreamLivenessSnapshot => {
    const nowMs = now()
    return {
      phase: phaseOverride ?? phase(),
      elapsedMs: streamStartMs === null ? 0 : nowMs - streamStartMs,
      firstReleasedChunkLatencyMs,
      timeSinceLastChunkMs:
        lastChunkAtMs === null ? null : nowMs - lastChunkAtMs,
      timeSinceLastProgressMs:
        streamStartMs === null ? 0 : nowMs - lastProgressAtMs,
      stalledThresholdMs,
      stepCounter,
      observedToolCalls,
      lastStepFinishReason,
      lastToolStepNumber,
      lastToolNames,
      awaitingPostToolContinuation,
      postToolContinuationDelayMs:
        postToolContinuationArmedAtMs === null
          ? null
          : nowMs - postToolContinuationArmedAtMs,
    }
  }

  const clearStalledTimer = () => {
    if (stalledTimer !== null) {
      clearTimeout(stalledTimer)
      stalledTimer = null
    }
  }

  const settled = () =>
    stalledCaptured || executionAbortCaptured || completed

  const armStalledTimer = () => {
    clearStalledTimer()
    if (settled()) return
    awaitingPostToolContinuation = true
    postToolContinuationArmedAtMs = now()
    stalledTimer = setTimeout(() => {
      if (settled()) return
      stalledCaptured = true
      onSignal("chat_stalled_continuation", snapshot("post_tool_continue"))
    }, stalledThresholdMs)
  }

  const resolvePostToolContinuation = () => {
    awaitingPostToolContinuation = false
    postToolContinuationArmedAtMs = null
    clearStalledTimer()
  }

  return {
    streamStarted() {
      streamStartMs = now()
      lastProgressAtMs = streamStartMs
    },
    stepEnded({ finishReason, toolCallCount, toolNames }) {
      stepCounter++
      observedToolCalls += toolCallCount
      lastProgressAtMs = now()
      lastStepFinishReason = finishReason ?? null
      if (finishReason === "tool-calls") {
        lastToolStepNumber = stepCounter
        lastToolNames = [...toolNames]
        armStalledTimer()
      } else {
        resolvePostToolContinuation()
      }
    },
    chunkReleased() {
      const nowMs = now()
      lastChunkAtMs = nowMs
      lastProgressAtMs = nowMs
      resolvePostToolContinuation()
      sawProviderChunk = true
      if (firstReleasedChunkLatencyMs === null && streamStartMs !== null) {
        firstReleasedChunkLatencyMs = nowMs - streamStartMs
      }
    },
    requestAborted() {
      if (clientAbortCaptured || completed) return
      clientAbortCaptured = true
      onSignal("chat_client_abort", snapshot())
    },
    executionAborted() {
      if (executionAbortCaptured || completed) return false
      executionAbortCaptured = true
      resolvePostToolContinuation()
      return true
    },
    completed() {
      completed = true
      lastProgressAtMs = now()
      resolvePostToolContinuation()
    },
    stepCount: () => stepCounter,
  }
}
