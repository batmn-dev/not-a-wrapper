"use client"

import { api } from "@/convex/_generated/api"
import { useDeadlineReached } from "@/hooks/use-clock"
import { ENABLE_DURABLE_RUN_PRESENTATION } from "@/lib/flags"
import { useConvexAuth, useMutation } from "convex/react"
import * as React from "react"
import { create } from "zustand"
import { isConvexId, type Chat } from "../types"

/**
 * Front-end status for a sidebar chat row's trailing indicator slot — our take
 * on ChatGPT's "dynamic slot" model, where each conversation row can surface a
 * small indicator (or nothing) based on the chat's live state.
 *
 * The values are deliberately *semantic* and few, not a 1:1 mirror of the
 * backend `generationRun` / `message` status enums (queued/running/streaming/
 * awaiting_approval/completed/aborted/failed…). That keeps the visual language
 * stable while the data feeding it evolves.
 *
 * How a row gets its status (docs/design/sidebar-status-backend-wiring.md):
 *  - The generation lifecycle **projects** run state onto the `chats` doc
 *    (`liveRunStatus`, plus the unread/error mirror). Each row already
 *    subscribes to its chat, so it derives its indicator from the object it
 *    already renders — no separate query, store, or hydrator.
 *  - This store holds only the *active-tab* live override (seam #1): the chat
 *    you are generating in publishes its `useChat` status here so its row lights
 *    up instantly on send, before the backend transition is visible. A non-idle
 *    override wins for that tab; an idle/ready override never lowers the backend
 *    (a re-entered background run keeps its projected spinner).
 */
export type SidebarChatStatus =
  | "idle" // no indicator; the slot collapses and the title uses full width
  | "streaming" // response generating — rotating ring
  | "awaiting" // blocked on the user (e.g. tool approval) — pulsing dot
  | "unread" // just finished / new, not yet opened — solid dot
  | "error" // last generation failed — destructive dot

/** The active tab's live status for the chat it is generating in (or null). */
export type LiveOverride = { chatId: string; status: SidebarChatStatus } | null

type SidebarChatStatusState = {
  liveOverride: LiveOverride
  /** Publish (or clear, with `null`) the active tab's live override. */
  setLiveOverride: (override: LiveOverride) => void
}

export const useSidebarChatStatusStore = create<SidebarChatStatusState>(
  (set) => ({
    liveOverride: null,
    setLiveOverride: (override) =>
      set((state) => {
        const prev = state.liveOverride
        // Referentially stable no-op when nothing changed, so a row subscribed
        // to its own override slice doesn't re-render on unrelated writes.
        if (
          prev === override ||
          (prev?.chatId === override?.chatId &&
            prev?.status === override?.status)
        ) {
          return state
        }
        return { liveOverride: override }
      }),
  })
)

/**
 * Derive a row's indicator from its chat doc plus the active-tab override. Pure.
 *
 * A **non-idle override wins**: it is authoritative for the tab issuing the
 * request, so a local `error` shows even while the backend's best-effort
 * terminal write lags, and the active row spins instantly on send. A local
 * idle/ready override never lowers the backend, so a re-entered background run
 * (whose `useChat` reads `ready` after the nav remount) keeps its projected
 * spinner. Optimistic/local chats carry no projection fields → `idle`.
 */
export function deriveChatRowStatus(
  chat: {
    live_run_status?: "streaming" | "awaiting" | null
    live_run_fresh_until?: number | null
    last_run_ended_at?: number | null
    last_run_status?: "completed" | "failed" | null
    last_read_at?: number | null
  },
  overrideStatus: SidebarChatStatus | null,
  now: number = Date.now(),
  durablePresentationEnabled: boolean = true
): SidebarChatStatus {
  if (overrideStatus && overrideStatus !== "idle") return overrideStatus
  // Freshness-bounded (durable-turn gameplan §11/§18 #4): the projection's
  // live phase renders only inside the once-written deadline — prepare's
  // route-budget ceiling, or the approval's own expiry. An expired deadline
  // NEVER renders a spinner; the reaper settles the row durably. A missing
  // deadline (pre-freshness rows, live-override-only paths) stays live —
  // the reaper still bounds it.
  const fresh =
    chat.live_run_fresh_until == null || now < chat.live_run_fresh_until
  if (
    durablePresentationEnabled &&
    fresh &&
    chat.live_run_status === "streaming"
  ) {
    return "streaming"
  }
  if (
    durablePresentationEnabled &&
    fresh &&
    chat.live_run_status === "awaiting"
  ) {
    return "awaiting"
  }
  if ((chat.last_run_ended_at ?? 0) > (chat.last_read_at ?? 0)) {
    if (chat.last_run_status === "failed") return "error"
    if (chat.last_run_status === "completed") return "unread"
  }
  return "idle"
}

/**
 * Subscribe a single row to its status. Takes the `chat` the row already
 * renders (reactive through the chat-list query) and derives the indicator. The
 * store selector returns only THIS row's override slice, so a `liveOverride`
 * change re-renders only the row it targets, not every subscribed row.
 */
export function useSidebarChatStatus(chat: Chat): SidebarChatStatus {
  const overrideStatus = useSidebarChatStatusStore((state) =>
    state.liveOverride?.chatId === chat.id ? state.liveOverride.status : null
  )
  const freshUntil = chat.live_run_fresh_until
  const isLive =
    chat.live_run_status === "streaming" || chat.live_run_status === "awaiting"
  // The expiry deadline is an external clock boundary, subscribed through
  // useSyncExternalStore instead of mirrored component state/effect.
  const deadlineReached = useDeadlineReached(
    freshUntil ?? null,
    ENABLE_DURABLE_RUN_PRESENTATION && isLive
  )
  const now =
    freshUntil == null ? 0 : deadlineReached ? freshUntil : freshUntil - 1
  return deriveChatRowStatus(
    chat,
    overrideStatus,
    now,
    ENABLE_DURABLE_RUN_PRESENTATION
  )
}

/**
 * Map the active chat's AI-SDK `useChat` status onto a sidebar slot status.
 * Only the states we can observe client-side are mapped; everything else falls
 * back to `idle`. Tool-approval ("awaiting") and "unread" arrive via the
 * backend projection on the chat doc, not from `useChat` — and a tool-approval
 * pause reports `ready` here (the stream finishes; it auto-continues once the
 * approval resolves), so the `idle` mapping lets the backend's `awaiting` dot
 * show through even for the active row.
 */
export function activeChatStatusToSidebarStatus(
  status: string
): SidebarChatStatus {
  switch (status) {
    case "submitted":
    case "streaming":
      return "streaming"
    case "error":
      return "error"
    default:
      return "idle"
  }
}

/**
 * Publish the active chat's live status into the store so its sidebar row shows
 * the right indicator while you generate. Clears on chat switch / unmount so a
 * stale ring never lingers on a row we're no longer the active tab for.
 * Front-end seam #1 — see the module docblock.
 */
export function usePublishActiveChatStatus(
  chatId: string | null,
  status: string
): void {
  const setLiveOverride = useSidebarChatStatusStore(
    (state) => state.setLiveOverride
  )

  React.useEffect(() => {
    if (!chatId) {
      setLiveOverride(null)
      return
    }
    setLiveOverride({
      chatId,
      status: activeChatStatusToSidebarStatus(status),
    })
  }, [chatId, status, setLiveOverride])

  // Separate cleanup keyed only on chatId: fire on chat switch / unmount, not on
  // every status transition (which would flash the slot to idle mid-stream).
  React.useEffect(() => {
    if (!chatId) return
    return () => useSidebarChatStatusStore.getState().setLiveOverride(null)
  }, [chatId])
}

/**
 * Clear a chat's unread/error by advancing `lastReadAt` to the observed
 * terminal mirror: on open, and again whenever the ACTIVE chat's terminal
 * mirror advances while viewing (covers a run that finished locally *and* one
 * you re-entered and watched). Navigating away before completion leaves it
 * unread. Backend-driven, independent of `useChat`.
 *
 * Gated on Convex auth to skip the common not-authenticated throw; a rarer "user
 * not found" during WorkOS→Convex user-row sync can still reject and is caught.
 * The tracking ref advances ONLY on success, so any failure retries on the next
 * open / run-advance / auth-ready render. No-op for guest / local- / optimistic
 * ids (isConvexId guard) — matching markChatRead's server-side owner no-op.
 */
export function useMarkChatReadOnView(
  chatId: string | null,
  lastRunEndedAt?: number | null
): void {
  const { isAuthenticated } = useConvexAuth()
  const markChatRead = useMutation(api.chats.markChatRead)
  const markedRef = React.useRef<{ chatId: string | null; endedAt: number }>({
    chatId: null,
    endedAt: 0,
  })

  React.useEffect(() => {
    if (!chatId || !isConvexId(chatId) || !isAuthenticated) return
    if (typeof lastRunEndedAt !== "number") return

    const ended = lastRunEndedAt
    const prev = markedRef.current
    const switchedChat = prev.chatId !== chatId
    const runAdvanced = !switchedChat && ended > prev.endedAt
    if (!switchedChat && !runAdvanced) return
    markChatRead({ chatId, readThroughAt: ended })
      .then(() => {
        markedRef.current = { chatId, endedAt: ended } // advance only on success
      })
      .catch(() => {}) // best-effort; ref unchanged → later render / auth-ready retries
  }, [chatId, lastRunEndedAt, isAuthenticated, markChatRead])
}
