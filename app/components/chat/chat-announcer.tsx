"use client"

import { useBreakpoint } from "@/hooks/use-breakpoint"
import type { GenerationPresentationState } from "@/lib/chat-runs/run-presentation"
import { useEffect, useSyncExternalStore, type ReactNode } from "react"
import {
  activeAnnouncement,
  announce,
  subscribeToAnnouncements,
} from "./aria-notify"

/**
 * Chat screen-reader announcements, routed through the aria-notify registry
 * (see `aria-notify.ts` — the port of the reference's `Ll` announcer). The
 * persistent live regions render the registry's active announcement per
 * priority; announcers enqueue with per-turn source ids and
 * interrupt/priority semantics instead of writing text into the DOM
 * themselves.
 */

const getServerText = () => ""

function usePoliteAnnouncement(): string {
  return useSyncExternalStore(
    subscribeToAnnouncements,
    () => activeAnnouncement("normal")?.message ?? "",
    getServerText
  )
}

function useAssertiveAnnouncement(): string {
  return useSyncExternalStore(
    subscribeToAnnouncements,
    () => activeAnnouncement("high")?.message ?? "",
    getServerText
  )
}

/** Compatibility wrapper — the registry is module-scoped, so the provider no
 * longer carries state. Kept so layout composition stays unchanged. */
export function ChatAnnouncerProvider({ children }: { children: ReactNode }) {
  return children
}

/**
 * The two persistent `sr-only` live regions. Mount once near the `<body>` root,
 * outside the app shell, so navigation never unmounts them mid-announcement.
 * `normal`-priority announcements render politely, `high` assertively.
 */
export function ChatAnnouncerOutlet() {
  const polite = usePoliteAnnouncement()
  const assertive = useAssertiveAnnouncement()
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {polite}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {assertive}
      </div>
    </>
  )
}

type ChatStatus = "streaming" | "ready" | "submitted" | "error"

/**
 * Derives a screen-reader announcement from the current chat status and
 * enqueues it into the registry on each transition. Source ids are scoped to
 * the active turn (the reference announces
 * `conversation-turn-${id}-${index}-thinking|-complete`); "Response complete"
 * uses `interrupt: "pending"` so it supersedes this turn's queued-but-unspoken
 * announcements, "Thinking" uses `interrupt: "none"` — both recovered verbatim
 * from the reference turn effect.
 *
 * Attached-stream finish evidence distinguishes a completed request from an
 * idle or newly opened chat. Desktop announces completion; mobile moves focus
 * to the final response in MessageAssistant. Empty text never announces.
 */
export function ChatStatusAnnouncer({
  status,
  isSubmitting,
  presentationState,
  completionAvailable = false,
  turnId,
}: {
  status?: ChatStatus
  isSubmitting?: boolean
  presentationState?: GenerationPresentationState
  completionAvailable?: boolean
  /** Active turn identity scoping the announcement sources. */
  turnId?: string | null
}) {
  const isMobile = useBreakpoint(768)
  const generating =
    isSubmitting === true || status === "submitted" || status === "streaming"
  const presentationAnnouncement = (() => {
    switch (presentationState) {
      case "local-submitted":
      case "local-streaming":
        return { polite: "Thinking", assertive: "" }
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
    (generating
      ? "Thinking"
      : completionAvailable && !isMobile
        ? "Response complete"
        : "")
  const assertive =
    presentationAnnouncement?.assertive ??
    (status === "error" ? "Something went wrong generating the response." : "")

  const sourceBase = turnId ? `conversation-turn-${turnId}` : "chat-status"

  useEffect(() => {
    if (!polite) return
    if (polite === "Response complete") {
      announce(polite, {
        id: `${sourceBase}-complete`,
        interrupt: "pending",
        priority: "normal",
      })
      return
    }
    announce(polite, {
      id:
        polite === "Thinking"
          ? `${sourceBase}-thinking`
          : `${sourceBase}-status`,
      interrupt: "none",
      priority: "normal",
    })
  }, [polite, sourceBase])

  useEffect(() => {
    if (!assertive) return
    announce(assertive, {
      id: `${sourceBase}-error`,
      interrupt: "none",
      priority: "high",
    })
  }, [assertive, sourceBase])

  return null
}
