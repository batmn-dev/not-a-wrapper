"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { GenerationPresentationState } from "@/lib/chat-runs/run-presentation"
import { createPortal } from "react-dom"

type Politeness = "polite" | "assertive"
type Slots = Record<Politeness, HTMLElement | null>

const AnnouncerContext = createContext<{
  slots: Slots
  setSlot: (politeness: Politeness, element: HTMLElement | null) => void
} | null>(null)

/**
 * Holds body-level live-region elements so the chat surface can portal
 * announcement text into them. The regions live at the document root so
 * announcements survive route changes, while the announced text is derived from
 * chat status deep in the tree (`<ChatStatusAnnouncer />`). The bridge shares a
 * DOM element via context — no prop-drilling and no effect.
 */
export function ChatAnnouncerProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slots>({ polite: null, assertive: null })
  // `setSlots` is stable; only re-render consumers when an element actually
  // changes (mount/unmount), never on streaming re-renders.
  const setSlot = useCallback(
    (politeness: Politeness, element: HTMLElement | null) => {
      setSlots((prev) =>
        prev[politeness] === element ? prev : { ...prev, [politeness]: element }
      )
    },
    []
  )
  const value = useMemo(() => ({ slots, setSlot }), [slots, setSlot])
  return (
    <AnnouncerContext.Provider value={value}>
      {children}
    </AnnouncerContext.Provider>
  )
}

/**
 * The two persistent `sr-only` live regions. Mount once near the `<body>` root,
 * outside the app shell, so navigation never unmounts them mid-announcement.
 */
export function ChatAnnouncerOutlet() {
  const setSlot = useContext(AnnouncerContext)?.setSlot
  // Stable callback refs: register on mount, clear on unmount.
  const politeRef = useCallback(
    (element: HTMLElement | null) => setSlot?.("polite", element),
    [setSlot]
  )
  const assertiveRef = useCallback(
    (element: HTMLElement | null) => setSlot?.("assertive", element),
    [setSlot]
  )
  return (
    <>
      <div
        ref={politeRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      <div
        ref={assertiveRef}
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      />
    </>
  )
}

type ChatStatus = "streaming" | "ready" | "submitted" | "error"

/**
 * Derives a screen-reader announcement from the current chat status and portals
 * it into the body-level live regions. The text changes only when the status
 * changes, so assistive tech announces each transition exactly once — no effect
 * and no transition tracking. Renders nothing visible.
 *
 * MVP scope: announces generation start (polite) and errors (assertive).
 * Completion announcement is intentionally omitted — distinguishing "just
 * finished" from "idle / opened an existing chat" requires transition state
 * (an effect), which we avoid here. Empty text never re-announces.
 */
export function ChatStatusAnnouncer({
  status,
  isSubmitting,
  presentationState,
}: {
  status?: ChatStatus
  isSubmitting?: boolean
  presentationState?: GenerationPresentationState
}) {
  const ctx = useContext(AnnouncerContext)
  const generating =
    isSubmitting === true || status === "submitted" || status === "streaming"
  const presentationAnnouncement = (() => {
    switch (presentationState) {
      case "local-submitted":
      case "local-streaming":
        return { polite: "Generating response.", assertive: "" }
      case "background-streaming":
        return { polite: "Generating in background.", assertive: "" }
      case "awaiting-approval":
        return { polite: "Approval required.", assertive: "" }
      case "stopping":
        return { polite: "Stopping generation.", assertive: "" }
      case "possibly-stale":
        return {
          polite: "Generation status is temporarily unavailable.",
          assertive: "",
        }
      case "stopped":
        return { polite: "Generation stopped.", assertive: "" }
      case "failed":
        return { polite: "", assertive: "Generation failed." }
      case "completed":
      case "superseded":
      case "settled":
      case undefined:
        return null
    }
  })()
  const polite =
    presentationAnnouncement?.polite ??
    (generating ? "Generating response." : "")
  const assertive =
    presentationAnnouncement?.assertive ??
    (status === "error"
      ? "Something went wrong generating the response."
      : "")

  if (!ctx) return null
  return (
    <>
      {ctx.slots.polite ? createPortal(polite, ctx.slots.polite) : null}
      {ctx.slots.assertive
        ? createPortal(assertive, ctx.slots.assertive)
        : null}
    </>
  )
}
