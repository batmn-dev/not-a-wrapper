import { useMemo, useSyncExternalStore } from "react"

const NO_SUBSCRIBE = () => () => undefined

function createPeriodicClock(intervalMs: number) {
  let now = Date.now()

  return {
    getSnapshot: () => now,
    getServerSnapshot: () => now,
    subscribe: (onStoreChange: () => void) => {
      const interval = window.setInterval(() => {
        now = Date.now()
        onStoreChange()
      }, intervalMs)
      return () => window.clearInterval(interval)
    },
  }
}

/**
 * A clock is an external system, so wall-clock reclassification belongs in an
 * external-store subscription rather than component state synchronized by an
 * effect. Disabled consumers keep their render-time snapshot and allocate no
 * timer.
 */
export function usePeriodicClock(enabled: boolean, intervalMs: number): number {
  const clock = useMemo(() => createPeriodicClock(intervalMs), [intervalMs])
  return useSyncExternalStore(
    enabled ? clock.subscribe : NO_SUBSCRIBE,
    clock.getSnapshot,
    clock.getServerSnapshot
  )
}

function createDeadlineStore(deadlineMs: number | null) {
  let reached = deadlineMs !== null && Date.now() >= deadlineMs

  return {
    getSnapshot: () => reached,
    getServerSnapshot: () => false,
    subscribe: (onStoreChange: () => void) => {
      if (deadlineMs === null || reached) return () => undefined
      const remaining = Math.max(0, deadlineMs - Date.now())
      const timeout = window.setTimeout(() => {
        reached = true
        onStoreChange()
      }, remaining)
      return () => window.clearTimeout(timeout)
    },
  }
}

/** Re-render once when an absolute wall-clock deadline is reached. */
export function useDeadlineReached(
  deadlineMs: number | null,
  enabled: boolean = true
): boolean {
  const store = useMemo(() => createDeadlineStore(deadlineMs), [deadlineMs])
  return useSyncExternalStore(
    enabled ? store.subscribe : NO_SUBSCRIBE,
    store.getSnapshot,
    store.getServerSnapshot
  )
}
