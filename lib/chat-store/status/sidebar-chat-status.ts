"use client"

import * as React from "react"
import { create } from "zustand"

/**
 * Front-end status for a sidebar chat row's leading indicator slot — our take
 * on ChatGPT's "dynamic slot" model, where each conversation row can surface a
 * small indicator (or nothing) based on the chat's live state.
 *
 * The values are deliberately *semantic* and few, not a 1:1 mirror of the
 * backend `generationRun` / `message` status enums (queued/running/streaming/
 * awaiting_approval/completed/aborted/failed…). That keeps the visual language
 * stable while the data feeding it evolves.
 *
 * Data sources, in order of arrival:
 *  1. Front-end, today — the *active* chat publishes its live `useChat` status
 *     (see `usePublishActiveChatStatus`, wired in `chat.tsx`). This lights up
 *     the row you're generating in.
 *  2. Backend, later — a Convex subscription over `generationRuns` (indexed
 *     `by_status` / `by_chat`) will hydrate *every* row's status regardless of
 *     which chat is open, and add the "unread / just finished" signal for
 *     background generations. It writes to this same store.
 */
export type SidebarChatStatus =
  | "idle" // no indicator; the slot collapses and the title uses full width
  | "streaming" // response generating — rotating ring
  | "awaiting" // blocked on the user (e.g. tool approval) — pulsing dot
  | "unread" // just finished / new, not yet opened — solid dot
  | "error" // last generation failed — destructive dot

type SidebarChatStatusState = {
  statuses: Record<string, SidebarChatStatus>
  /** Set (or, when `idle`, remove) a single chat's status. */
  setChatStatus: (chatId: string, status: SidebarChatStatus) => void
  /** Remove a single chat's status (equivalent to setting it `idle`). */
  clearChatStatus: (chatId: string) => void
  /** Drop every status (e.g. on sign-out). */
  resetChatStatuses: () => void
}

export const useSidebarChatStatusStore = create<SidebarChatStatusState>(
  (set) => ({
    statuses: {},
    setChatStatus: (chatId, status) =>
      set((state) => {
        if (status === "idle") {
          if (!(chatId in state.statuses)) return state
          const next = { ...state.statuses }
          delete next[chatId]
          return { statuses: next }
        }
        if (state.statuses[chatId] === status) return state
        return { statuses: { ...state.statuses, [chatId]: status } }
      }),
    clearChatStatus: (chatId) =>
      set((state) => {
        if (!(chatId in state.statuses)) return state
        const next = { ...state.statuses }
        delete next[chatId]
        return { statuses: next }
      }),
    resetChatStatuses: () => set({ statuses: {} }),
  })
)

/**
 * Subscribe a single row to its status. Returns `"idle"` when unset, so a row
 * that no source has touched renders no slot.
 */
export function useSidebarChatStatus(chatId: string): SidebarChatStatus {
  return useSidebarChatStatusStore((state) => state.statuses[chatId] ?? "idle")
}

/**
 * Map the active chat's AI-SDK `useChat` status onto a sidebar slot status.
 * Only the states we can observe client-side are mapped; everything else falls
 * back to `idle`. Tool-approval ("awaiting") and "unread" arrive with the
 * backend subscription, not from `useChat`.
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
 * stale ring never lingers on a row we're no longer generating in. Front-end
 * seam #1 — see the module docblock.
 */
export function usePublishActiveChatStatus(
  chatId: string | null,
  status: string
): void {
  const setChatStatus = useSidebarChatStatusStore(
    (state) => state.setChatStatus
  )

  React.useEffect(() => {
    if (!chatId) return
    setChatStatus(chatId, activeChatStatusToSidebarStatus(status))
  }, [chatId, status, setChatStatus])

  // Separate cleanup keyed only on chatId: fire on chat switch / unmount, not
  // on every status transition (which would flash the slot to idle mid-stream).
  React.useEffect(() => {
    if (!chatId) return
    return () => useSidebarChatStatusStore.getState().clearChatStatus(chatId)
  }, [chatId])
}

/**
 * DEV/preview only. When the URL carries `?sidebarStatusPreview=1`, seed a
 * rotating set of demo statuses onto the first few chat rows so every indicator
 * variant is visible without any backend wiring. No-op otherwise, and it cleans
 * up its seeded rows on unmount / param change.
 */
export function useSidebarChatStatusPreview(chatIds: string[]): void {
  const setChatStatus = useSidebarChatStatusStore(
    (state) => state.setChatStatus
  )
  const key = chatIds.join(",")

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    if (!params.has("sidebarStatusPreview")) return

    const demo: SidebarChatStatus[] = [
      "streaming",
      "unread",
      "awaiting",
      "error",
    ]
    const seeded = key ? key.split(",").slice(0, demo.length) : []
    seeded.forEach((id, index) => setChatStatus(id, demo[index]))
    return () => seeded.forEach((id) => setChatStatus(id, "idle"))
  }, [key, setChatStatus])
}
