"use client"

/**
 * Activity panel store — the seam assistant rows use to reach the single
 * Chat-hosted Activity panel. See CONTEXT.md "Activity panel".
 *
 * Replaces the `activityPanel` controls object that threaded Chat →
 * Conversation → Message → MessageAssistant. That thread had two structural
 * problems this store removes:
 *
 *  1. Stale closures. `onOpenTurn` closed over `defaultActivityTurnId` at
 *     render time, and the row memo deliberately compared only inner fields —
 *     so a memo-blocked row could classify a trigger click against an
 *     OUTDATED default and follow the wrong turn. Here `openTurn` classifies
 *     against the store's CURRENT state at call time; the action identities
 *     never change.
 *
 *  2. Re-render blast radius. `activityPanelTurnId` was a prop on every row,
 *     so a panel handoff re-rendered the whole thread. Rows now subscribe to
 *     one boolean (`useIsActivityPanelTurnOpen`) — only the two rows whose
 *     answer flips re-render.
 *
 * Ownership: the store owns the USER state (open, explicit selection). The
 * authoritative selection derivation stays in `selectActivityPanelTarget`
 * (use-activity-panel.ts) — Chat runs it against messages/status and syncs
 * the result in via `setDerivedTurnIds`. `openTurn` sets `panelTurnId`
 * optimistically (the clicked turn is by definition present), so the trigger's
 * aria-expanded flips in the same commit; the synced derivation corrects any
 * fallback case one commit later.
 */

import { ScrollRootContext } from "@/components/ui/scroll-root"
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { selectExplicitActivityTurnOnOpen } from "../use-activity-panel"

export type ActivityPanelStoreState = {
  /** Whether the single panel surface is expanded. */
  open: boolean
  /** Explicit user selection; undefined = follow the generation default. */
  selectedTurnId: string | undefined
  /** The turn currently projected into the panel (selected ?? default). */
  panelTurnId: string | undefined
  /** The generation-following default turn id. */
  defaultTurnId: string | undefined
}

export type ActivityPanelStore = {
  getState: () => ActivityPanelStoreState
  subscribe: (listener: () => void) => () => void
  /**
   * Sync the authoritative selection derivation (selectActivityPanelTarget)
   * into the store. Called from an effect in Chat whenever the derivation's
   * inputs (messages, status, selection) change.
   */
  setDerivedTurnIds: (next: {
    panelTurnId: string | undefined
    defaultTurnId: string | undefined
  }) => void
  /**
   * Select a turn and open the panel. Explicit-vs-default classification runs
   * against the store's CURRENT defaultTurnId — never a render-time closure.
   */
  openTurn: (turnId: string) => void
  setOpen: (open: boolean) => void
  /** Wire the side effect fired when a turn opens the panel (e.g. scroll-lock
   * release). The provider owns this wiring — see below. */
  setOnOpen: (onOpen: (() => void) | null) => void
}

export function createActivityPanelStore(): ActivityPanelStore {
  let state: ActivityPanelStoreState = {
    open: false,
    selectedTurnId: undefined,
    panelTurnId: undefined,
    defaultTurnId: undefined,
  }
  let onOpen: (() => void) | null = null
  const listeners = new Set<() => void>()

  const setState = (partial: Partial<ActivityPanelStoreState>) => {
    const next = { ...state, ...partial }
    if (
      next.open === state.open &&
      next.selectedTurnId === state.selectedTurnId &&
      next.panelTurnId === state.panelTurnId &&
      next.defaultTurnId === state.defaultTurnId
    ) {
      return
    }
    state = next
    listeners.forEach((listener) => listener())
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setDerivedTurnIds: ({ panelTurnId, defaultTurnId }) => {
      setState({ panelTurnId, defaultTurnId })
    },
    openTurn: (turnId) => {
      onOpen?.()
      setState({
        selectedTurnId: selectExplicitActivityTurnOnOpen({
          requestedTurnId: turnId,
          defaultActivityTurnId: state.defaultTurnId,
        }),
        // Optimistic: the clicked turn is the panel turn in the same commit;
        // the authoritative derivation confirms (or corrects a fallback) via
        // setDerivedTurnIds on the next sync.
        panelTurnId: turnId,
        open: true,
      })
    },
    setOpen: (open) => {
      if (open) {
        setState({ open: true })
        return
      }
      // Closing clears the explicit selection (matching the previous
      // Chat-owned handleActivityPanelOpenChange) and re-points the panel at
      // the generation default.
      setState({
        open: false,
        selectedTurnId: undefined,
        panelTurnId: state.defaultTurnId,
      })
    },
    setOnOpen: (next) => {
      onOpen = next
    },
  }
}

const ActivityPanelStoreContext = createContext<ActivityPanelStore | null>(
  null
)
const ActivityPanelIdContext = createContext<string | undefined>(undefined)

export function ActivityPanelStoreProvider({
  store,
  panelId,
  children,
}: {
  store: ActivityPanelStore
  panelId?: string
  children: ReactNode
}) {
  // Opening the docked panel narrows the thread column, which reflows the
  // conversation taller. `use-stick-to-bottom` would read that positive resize
  // as "follow new content" and animate to the bottom — but clicking a
  // thinking trigger must leave the scroll position untouched. Releasing the
  // lock (same lever the user-message edit uses) makes the resize a no-op, so
  // native scroll anchoring holds the view in place. The provider owns this
  // wiring so the scroll quirk stays internal to the panel module. Read
  // defensively: the provider may mount outside a ScrollRoot in tests.
  const scrollRoot = useContext(ScrollRootContext)
  const stopScroll = scrollRoot?.stopScroll
  useEffect(() => {
    store.setOnOpen(stopScroll ? () => stopScroll() : null)
    return () => store.setOnOpen(null)
  }, [store, stopScroll])

  return (
    <ActivityPanelStoreContext.Provider value={store}>
      <ActivityPanelIdContext.Provider value={panelId}>
        {children}
      </ActivityPanelIdContext.Provider>
    </ActivityPanelStoreContext.Provider>
  )
}

const noopSubscribe = () => () => {}

/**
 * Row subscription: "is this message the open panel turn?" Returns a single
 * boolean so useSyncExternalStore re-renders the row only when the answer
 * flips (Object.is on the snapshot) — a panel handoff re-renders exactly the
 * two affected rows.
 */
export function useIsActivityPanelTurnOpen(
  messageId: string,
  serverMessageId?: string
): boolean {
  const store = useContext(ActivityPanelStoreContext)
  return useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    () => {
      if (!store) return false
      const state = store.getState()
      if (!state.open || state.panelTurnId === undefined) return false
      return (
        state.panelTurnId === messageId ||
        (serverMessageId !== undefined &&
          state.panelTurnId === serverMessageId)
      )
    },
    () => false
  )
}

export type ActivityPanelActions = {
  openTurn: (turnId: string) => void
  close: () => void
}

/**
 * Stable panel actions, or null when no panel is hosted (e.g. isolated row
 * renders in tests) — the trigger-visibility gate.
 */
export function useActivityPanelActions(): ActivityPanelActions | null {
  const store = useContext(ActivityPanelStoreContext)
  return useMemo(() => {
    if (!store) return null
    return {
      openTurn: store.openTurn,
      close: () => store.setOpen(false),
    }
  }, [store])
}

/** The panel surface's DOM id, for the trigger's aria-controls. */
export function useActivityPanelId(): string | undefined {
  return useContext(ActivityPanelIdContext)
}

/** Chat-side subscription to the open flag (renders the panel surface). */
export function useActivityPanelOpen(store: ActivityPanelStore): boolean {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().open,
    () => false
  )
}

/** Chat-side subscription to the explicit selection (selector input). */
export function useActivityPanelSelectedTurnId(
  store: ActivityPanelStore
): string | undefined {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().selectedTurnId,
    () => undefined
  )
}
