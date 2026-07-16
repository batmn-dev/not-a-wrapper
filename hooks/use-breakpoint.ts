import { useMemo, useSyncExternalStore } from "react"

function createBreakpointStore(breakpoint: number) {
  let isSubscribed = false

  const getSnapshot = () => isSubscribed && window.innerWidth < breakpoint

  return {
    getSnapshot,
    getServerSnapshot: () => false,
    subscribe: (onStoreChange: () => void) => {
      const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
      const onChange = () => onStoreChange()

      mql.addEventListener("change", onChange)
      isSubscribed = true
      onStoreChange()

      return () => mql.removeEventListener("change", onChange)
    },
  }
}

export function useBreakpoint(breakpoint: number) {
  const store = useMemo(() => createBreakpointStore(breakpoint), [breakpoint])

  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  )
}
