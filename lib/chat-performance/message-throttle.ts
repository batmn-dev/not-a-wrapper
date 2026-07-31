import type { Chat, UIMessage } from "@ai-sdk/react"

type ScheduledPublication =
  | { kind: "frame"; id: number }
  | { kind: "timeout"; id: ReturnType<typeof setTimeout> }
  | null

/**
 * Subscribe React to the Chat's canonical messages at most once per browser
 * paint while a response is streaming.
 *
 * AI SDK still mutates `chat.messages` immediately for every stream part.
 * This only coalesces subscriber notifications, so there is no second text
 * store to reconcile. Non-streaming writes and terminal status/error
 * transitions publish synchronously; a pending frame is cancelled first so
 * it cannot repaint stale work after completion, Stop, or failure.
 */
export function subscribeToFrameAlignedMessages<UI_MESSAGE extends UIMessage>(
  chat: Chat<UI_MESSAGE>,
  onChange: () => void
): () => void {
  let scheduled: ScheduledPublication = null
  let pending = false

  const cancelScheduledPublication = () => {
    if (scheduled?.kind === "frame") {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(scheduled.id)
      }
    } else if (scheduled?.kind === "timeout") {
      clearTimeout(scheduled.id)
    }
    scheduled = null
  }

  const publish = () => {
    cancelScheduledPublication()
    if (!pending) return
    pending = false
    onChange()
  }

  const schedule = () => {
    pending = true
    if (scheduled) return

    if (typeof requestAnimationFrame === "function") {
      scheduled = {
        kind: "frame",
        id: requestAnimationFrame(publish),
      }
      return
    }

    // SSR/test/non-window fallback. Browsers always use the paint-aligned
    // branch above; this merely preserves eventual publication elsewhere.
    scheduled = {
      kind: "timeout",
      id: setTimeout(publish, 0),
    }
  }

  const unsubscribeMessages = chat["~registerMessagesCallback"](() => {
    if (chat.status === "streaming") schedule()
    else {
      pending = true
      publish()
    }
  })
  const unsubscribeStatus = chat["~registerStatusCallback"](() => {
    if (chat.status !== "streaming") publish()
  })
  const unsubscribeError = chat["~registerErrorCallback"](publish)

  return () => {
    unsubscribeMessages()
    unsubscribeStatus()
    unsubscribeError()
    pending = false
    cancelScheduledPublication()
  }
}
