import { useMemo, useSyncExternalStore } from "react"

function createPeriodicClock(intervalMs: number, enabled: boolean) {
  let now = Date.now()

  return {
    getSnapshot: () => now,
    getServerSnapshot: () => now,
    subscribe: (onStoreChange: () => void) => {
      if (!enabled) return () => undefined
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
  const clock = useMemo(
    () => createPeriodicClock(intervalMs, enabled),
    [intervalMs, enabled]
  )
  return useSyncExternalStore(
    clock.subscribe,
    clock.getSnapshot,
    clock.getServerSnapshot
  )
}

function createDeadlineStore(deadlineMs: number | null, enabled: boolean) {
  let reached = deadlineMs !== null && Date.now() >= deadlineMs

  return {
    getSnapshot: () => reached,
    getServerSnapshot: () => false,
    subscribe: (onStoreChange: () => void) => {
      if (!enabled || deadlineMs === null || reached) return () => undefined
      const remaining = deadlineMs - Date.now()
      if (remaining <= 0) {
        reached = true
        return () => undefined
      }
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
  const store = useMemo(
    () => createDeadlineStore(deadlineMs, enabled),
    [deadlineMs, enabled]
  )
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  )
}
