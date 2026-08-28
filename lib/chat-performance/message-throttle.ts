import { markChatPerf } from "@/lib/observability/chat-performance"
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
  // Per-streaming-session accounting (measurement plan Phase 2): SDK message
  // callbacks observed vs publications delivered while streaming. Emitted as
  // ONE summary mark when the session leaves `streaming`; proves the
  // ≤1-publication-per-frame invariant. markChatPerf is a no-op unless the
  // instrumentation build flag is on.
  let streamingCallbackCount = 0
  let streamingPublicationCount = 0
  let inStreamingSession = false

  const flushStreamingSummary = () => {
    if (!inStreamingSession) return
    inStreamingSession = false
    markChatPerf("stream_publication_summary", {
      callbackCount: streamingCallbackCount,
      publicationCount: streamingPublicationCount,
      coalescedCount: Math.max(
        0,
        streamingCallbackCount - streamingPublicationCount
      ),
    })
    streamingCallbackCount = 0
    streamingPublicationCount = 0
  }

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
    if (chat.status === "streaming") streamingPublicationCount++
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
    if (chat.status === "streaming") {
      inStreamingSession = true
      streamingCallbackCount++
      schedule()
    } else {
      pending = true
      publish()
    }
  })
  const unsubscribeStatus = chat["~registerStatusCallback"](() => {
    if (chat.status !== "streaming") {
      publish()
      flushStreamingSummary()
    }
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
