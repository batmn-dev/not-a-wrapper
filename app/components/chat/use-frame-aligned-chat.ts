"use client"

import { subscribeToFrameAlignedMessages } from "@/lib/chat-performance/message-throttle"
import type { Chat, UIMessage, UseChatHelpers } from "@ai-sdk/react"
import { useCallback, useSyncExternalStore } from "react"

function replaceChatMessages<UI_MESSAGE extends UIMessage>(
  chat: Chat<UI_MESSAGE>,
  next: UI_MESSAGE[] | ((messages: UI_MESSAGE[]) => UI_MESSAGE[])
) {
  chat.messages = typeof next === "function" ? next(chat.messages) : next
}

/**
 * `useChat({ throttle: 16 })` uses a wall-clock timer. That spans two paints
 * on a 120 Hz display and can fire between paints. This adapter keeps AI SDK's
 * Chat as the sole canonical store while aligning streaming notifications to
 * the display's actual refresh cadence.
 */
export function useFrameAlignedChat<UI_MESSAGE extends UIMessage>({
  chat,
}: {
  chat: Chat<UI_MESSAGE>
}): UseChatHelpers<UI_MESSAGE> {
  const subscribeToMessages = useCallback(
    (onChange: () => void) => subscribeToFrameAlignedMessages(chat, onChange),
    [chat]
  )

  const messages = useSyncExternalStore(
    subscribeToMessages,
    () => chat.messages,
    () => chat.messages
  )
  const status = useSyncExternalStore(
    chat["~registerStatusCallback"],
    () => chat.status,
    () => chat.status
  )
  const error = useSyncExternalStore(
    chat["~registerErrorCallback"],
    () => chat.error,
    () => chat.error
  )

  const setMessages = useCallback(
    (next: UI_MESSAGE[] | ((messages: UI_MESSAGE[]) => UI_MESSAGE[])) => {
      replaceChatMessages(chat, next)
    },
    [chat]
  )

  return {
    id: chat.id,
    messages,
    setMessages,
    sendMessage: chat.sendMessage,
    regenerate: chat.regenerate,
    clearError: chat.clearError,
    stop: chat.stop,
    error,
    resumeStream: chat.resumeStream,
    status,
    addToolResult: chat.addToolOutput,
    addToolOutput: chat.addToolOutput,
    addToolApprovalResponse: chat.addToolApprovalResponse,
  }
}
