import { toast } from "@/components/ui/toast"
import { getOrCreateGuestUserId } from "@/lib/api"
import { createOptimisticEditMessageId } from "@/lib/chat-store/identity"
import { MESSAGE_MAX_LENGTH, SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import type { UserProfile } from "@/lib/user/types"
import type { UIMessage } from "@ai-sdk/react"
import type { RefObject } from "react"
import { useCallback } from "react"

// Extended UIMessage type for optimistic updates that includes createdAt
type OptimisticUIMessage = UIMessage & { createdAt?: Date }

type UseChatEditProps = {
  chatId: string | null
  messages: UIMessage[]
  user: UserProfile | null
  checkLimitsAndNotify: (uid: string) => Promise<boolean>
  ensureChatExists: (uid: string, input: string) => Promise<string | null>
  selectedModel: string
  isAuthenticated: boolean
  systemPrompt: string
  enableSearch: boolean
  sendMessage: (
    message: {
      text: string
      files?: Array<{
        type: "file"
        filename: string
        mediaType: string
        url: string
      }>
    },
    options?: { body?: Record<string, unknown> }
  ) => void
  setMessages: (
    messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])
  ) => void
  /** Stage a user message for deferred persistence in onFinish (avoids mutating provider state during sendMessage). */
  setPendingEditUserMessage: (message: UIMessage, chatId: string) => void
  bumpChat: (chatId: string) => void
  updateTitle: (chatId: string, title: string) => Promise<void>
  isSubmitting: boolean
  status: string
  deleteMessagesFromTimestamp: (
    timestamp: number,
    minVersion?: number
  ) => Promise<void>
  prevChatIdRef: RefObject<string | null>
}

export function useChatEdit({
  chatId,
  messages,
  user,
  checkLimitsAndNotify,
  ensureChatExists,
  selectedModel,
  isAuthenticated,
  systemPrompt,
  enableSearch,
  sendMessage,
  setMessages,
  setPendingEditUserMessage,
  bumpChat,
  updateTitle,
  isSubmitting,
  status,
  deleteMessagesFromTimestamp,
  prevChatIdRef,
}: UseChatEditProps) {
  const submitEdit = useCallback(
    async (messageId: string, newContent: string) => {
      // Block edits while sending/streaming
      if (isSubmitting || status === "submitted" || status === "streaming") {
        toast({
          title: "Please wait until the current message finishes sending.",
          status: "error",
        })
        return
      }

      if (!newContent.trim()) return

      if (!chatId) {
        toast({ title: "Missing chat.", status: "error" })
        return
      }

      // Find edited message
      const editIndex = messages.findIndex(
        (m) => String(m.id) === String(messageId)
      )
      if (editIndex === -1) {
        toast({ title: "Message not found", status: "error" })
        return
      }

      const target = messages[editIndex] as OptimisticUIMessage
      const cutoffTimestamp = target?.createdAt?.getTime()
      if (!cutoffTimestamp) {
        console.error("Unable to locate message timestamp.")
        return
      }

      if (newContent.length > MESSAGE_MAX_LENGTH) {
        toast({
          title: `The message you submitted was too long, please submit something shorter. (Max ${MESSAGE_MAX_LENGTH} characters)`,
          status: "error",
        })
        return
      }

      // Store original messages for potential rollback
      const originalMessages = [...messages]

      const optimisticId = createOptimisticEditMessageId()

      // Extract file parts from target message for the edited message
      const targetFileParts =
        target.parts?.filter((p) => p.type === "file") || []

      // Create optimistic message with v6 parts format (includes createdAt for app compatibility)
      const optimisticEditedMessage: OptimisticUIMessage = {
        id: optimisticId,
        role: "user",
        createdAt: new Date(),
        parts: [{ type: "text", text: newContent }, ...targetFileParts],
      }

      try {
        const trimmedMessages = messages.slice(0, editIndex)
        setMessages([...trimmedMessages, optimisticEditedMessage])

        // Get user validation first (before any permanent deletions)
        const uid = await getOrCreateGuestUserId(user)
        if (!uid) {
          setMessages(originalMessages)
          toast({ title: "Please sign in and try again.", status: "error" })
          return
        }

        const allowed = await checkLimitsAndNotify(uid)
        if (!allowed) {
          setMessages(originalMessages)
          return
        }

        const currentChatId = await ensureChatExists(uid, newContent)
        if (!currentChatId) {
          setMessages(originalMessages)
          return
        }

        prevChatIdRef.current = currentChatId

        // Only persist deletions AFTER all validation passes
        // This prevents data loss if the edit is rejected
        try {
          const { writeToIndexedDB } = await import("@/lib/chat-store/persist")
          await writeToIndexedDB("messages", {
            id: chatId,
            messages: trimmedMessages,
          })
        } catch {}

        // Delete messages from the edit point in Convex database
        // This ensures subsequent messages are removed from persistent storage
        await deleteMessagesFromTimestamp(cutoffTimestamp, trimmedMessages.length + 1)

        // If this is an edit of the very first user message, update chat title
        if (editIndex === 0 && target.role === "user") {
          try {
            await updateTitle(currentChatId, newContent)
          } catch {}
        }

        // First truncate messages to the edit point
        setMessages(trimmedMessages)

        // Convert target file parts to the format expected by sendMessage
        const targetFiles = targetFileParts.map((p) => ({
          type: "file" as const,
          filename: (p as { filename?: string }).filename || "file",
          mediaType:
            (p as { mediaType?: string }).mediaType ||
            "application/octet-stream",
          url: (p as { url?: string }).url || "",
        }))

        sendMessage(
          {
            text: newContent,
            files: targetFiles.length > 0 ? targetFiles : undefined,
          },
          {
            body: {
              chatId: currentChatId,
              userId: uid,
              model: selectedModel,
              isAuthenticated,
              systemPrompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
              enableSearch,
              chatVersion: trimmedMessages.length + 1, // monotonic: messages remaining after truncation + 1 for new message
            },
          }
        )

        // Remove optimistic message (sendMessage will add the real one)
        setMessages((prev) => prev.filter((msg) => msg.id !== optimisticId))

        // Stage for deferred persistence in onFinish (avoids provider state
        // mutation during the same batch as sendMessage/setMessages)
        setPendingEditUserMessage(optimisticEditedMessage, currentChatId)

        bumpChat(currentChatId)
      } catch (error) {
        console.error("Edit failed:", error)
        setMessages(originalMessages)
        toast({ title: "Failed to apply edit", status: "error" })
      }
    },
    [
      chatId,
      messages,
      user,
      checkLimitsAndNotify,
      ensureChatExists,
      selectedModel,
      isAuthenticated,
      systemPrompt,
      enableSearch,
      sendMessage,
      setMessages,
      setPendingEditUserMessage,
      bumpChat,
      updateTitle,
      isSubmitting,
      status,
      deleteMessagesFromTimestamp,
      prevChatIdRef,
    ]
  )

  return { submitEdit }
}
