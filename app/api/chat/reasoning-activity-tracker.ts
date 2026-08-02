export type ReasoningActivityTracker = {
  start: (blockId: string) => void
  end: (blockId: string) => void
  close: () => void
  getDurationMs: () => number | undefined
}

/**
 * Request-local interval-union accounting for reasoning lifecycle blocks.
 * Overlapping blocks share one wall-clock interval, while gaps between blocks
 * (for example, tool execution) are excluded. `initialDurationMs` carries a
 * prior segment's total across an approval pause — terminal metadata replaces
 * the message's metadata wholesale, so a continuation that starts from zero
 * would erase the pre-pause reasoning time.
 */
export function createReasoningActivityTracker(
  now: () => number = Date.now,
  initialDurationMs?: number
): ReasoningActivityTracker {
  const activeBlockIds = new Set<string>()
  let intervalStartMs: number | undefined
  let elapsedMs = Math.max(0, initialDurationMs ?? 0)
  let observed = initialDurationMs !== undefined
  let closed = false

  const finishInterval = () => {
    if (intervalStartMs === undefined) return
    elapsedMs += Math.max(0, now() - intervalStartMs)
    intervalStartMs = undefined
  }

  return {
    start(blockId) {
      if (closed || activeBlockIds.has(blockId)) return
      if (activeBlockIds.size === 0) intervalStartMs = now()
      activeBlockIds.add(blockId)
      observed = true
    },
    end(blockId) {
      if (closed || !activeBlockIds.delete(blockId)) return
      if (activeBlockIds.size === 0) finishInterval()
    },
    close() {
      if (closed) return
      closed = true
      finishInterval()
      activeBlockIds.clear()
    },
    getDurationMs() {
      if (!observed) return undefined
      if (intervalStartMs === undefined) return elapsedMs
      return elapsedMs + Math.max(0, now() - intervalStartMs)
    },
  }
}
