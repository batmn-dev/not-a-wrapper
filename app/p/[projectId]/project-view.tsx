"use client"
import { RiChat3Line } from "@remixicon/react"

import { ChatInput } from "@/app/components/chat-input/chat-input"
import { Conversation } from "@/app/components/chat/conversation"
import { useFileUpload } from "@/app/components/chat/use-file-upload"
import { useModel } from "@/app/components/chat/use-model"
import { ProjectChatItem } from "@/app/components/layout/sidebar/project-chat-item"
import { toast } from "@/components/ui/toast"
import { convertAttachmentsToFiles } from "@/lib/ai/message-conversion"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useMessages } from "@/lib/chat-store/messages/provider"
import { MESSAGE_MAX_LENGTH, SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { Attachment } from "@/lib/file-handling"
import { API_ROUTE_CHAT } from "@/lib/routes"
import { useUser } from "@/lib/user-store/provider"
import {
  persistWebSearchToggle,
  resolveWebSearchEnabled,
} from "@/lib/user-preference-store/web-search"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { cn } from "@/lib/utils"
import type { UIMessage } from "@ai-sdk/react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"

// Extended UIMessage type for optimistic updates that includes createdAt
type OptimisticUIMessage = UIMessage & { createdAt?: Date }
import { useQuery } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

type Project = {
  id: string
  name: string
  user_id: string
  created_at: string
}

type ProjectViewProps = {
  projectId: string
}

export function ProjectView({ projectId }: ProjectViewProps) {
  const isSendingRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { preferences, setWebSearchEnabled } = useUserPreferences()
  const [enableSearch, setEnableSearchState] = useState(() =>
    resolveWebSearchEnabled(preferences.webSearchEnabled)
  )
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const { user } = useUser()
  const { createNewChat, bumpChat } = useChats()
  const { cacheAndAddMessage } = useMessages()
  const pathname = usePathname()
  const {
    files,
    setFiles,
    handleFileUploads,
    createOptimisticAttachments,
    cleanupOptimisticAttachments,
    handleFileUpload,
    handleFileRemove,
  } = useFileUpload()

  // Manual input state management (v6 no longer returns input/setInput from useChat)
  const [input, setInput] = useState("")

  // Fetch project details
  const { data: project } = useQuery<Project>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}`)
      if (!response.ok) {
        throw new Error("Failed to fetch project")
      }
      return response.json()
    },
  })

  // Get chats from the chat store and filter for this project
  const { chats: allChats } = useChats()

  // Filter chats for this project
  const chats = allChats.filter((chat) => chat.project_id === projectId)

  const isAuthenticated = useMemo(() => !!user?.id, [user?.id])

  const setEnableSearch = useCallback(
    (enabled: boolean) => {
      persistWebSearchToggle(enabled, setEnableSearchState, setWebSearchEnabled)
    },
    [setWebSearchEnabled]
  )

  useEffect(() => {
    setEnableSearchState(resolveWebSearchEnabled(preferences.webSearchEnabled))
  }, [preferences.webSearchEnabled])

  // Handle errors directly in onError callback
  const handleError = useCallback((error: Error) => {
    let errorMsg = "Something went wrong."
    try {
      const parsed = JSON.parse(error.message)
      errorMsg = parsed.error || errorMsg
    } catch {
      errorMsg = error.message || errorMsg
    }
    toast({
      title: errorMsg,
      status: "error",
    })
  }, [])

  // Memoized transport for v6
  const transport = useMemo(
    () => new DefaultChatTransport({ api: API_ROUTE_CHAT }),
    []
  )

  // Initialize useChat with v6 API
  const {
    messages,
    sendMessage,
    regenerate,
    status,
    stop,
    setMessages,
  } = useChat({
    id: `project-${projectId}-${currentChatId}`,
    transport,
    messages: [],

    onFinish: ({ message, isAbort, isError }) => {
      // Skip processing for aborted or errored responses
      if (isAbort || isError) return
      // Pass currentChatId explicitly to handle stale closures during chat creation
      if (currentChatId) {
        cacheAndAddMessage(message, currentChatId)
      }
    },

    onError: handleError,
  })

  const { selectedModel, handleModelChange } = useModel({
    currentChat: null,
    user,
    updateChatModel: () => Promise.resolve(),
    chatId: null,
  })

  // Simplified ensureChatExists for authenticated project context
  const ensureChatExists = useCallback(
    async (userId: string) => {
      // If we already have a current chat ID, return it
      if (currentChatId) {
        return currentChatId
      }

      // Only create a new chat if we haven't started one yet
      if (messages.length === 0) {
        try {
          const newChat = await createNewChat(
            userId,
            input,
            selectedModel,
            true, // Always authenticated in this context
            SYSTEM_PROMPT_DEFAULT,
            projectId
          )

          if (!newChat) return null

          setCurrentChatId(newChat.id)
          // Redirect to the chat page as expected
          window.history.pushState(null, "", `/c/${newChat.id}`)
          return newChat.id
        } catch (err: unknown) {
          let errorMessage = "Something went wrong."
          try {
            const errorObj = err as { message?: string }
            if (errorObj.message) {
              const parsed = JSON.parse(errorObj.message)
              errorMessage = parsed.error || errorMessage
            }
          } catch {
            const errorObj = err as { message?: string }
            errorMessage = errorObj.message || errorMessage
          }
          toast({
            title: errorMessage,
            status: "error",
          })
          return null
        }
      }

      return currentChatId
    },
    [
      currentChatId,
      messages.length,
      createNewChat,
      input,
      selectedModel,
      projectId,
    ]
  )

  // Project context doesn't need rate-limit or chat-creation utils from
  // useChatOperations — only local message handlers are needed here.
  const handleDelete = useCallback(
    (id: string) => {
      setMessages((prev) => prev.filter((message) => message.id !== id))
    },
    [setMessages]
  )

  const handleEdit = useCallback(
    (id: string, newText: string) => {
      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== id) return message
          const nonTextParts =
            message.parts?.filter((p) => p.type !== "text") ?? []
          return {
            ...message,
            content: newText,
            parts: [{ type: "text" as const, text: newText }, ...nonTextParts],
          }
        })
      )
    },
    [setMessages]
  )

  // Simple input change handler for project context (no draft saving needed)
  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value)
    },
    [setInput]
  )

  const submit = useCallback(async () => {
    if (isSendingRef.current) return
    isSendingRef.current = true
    setIsSubmitting(true)

    if (!user?.id) {
      setIsSubmitting(false)
      isSendingRef.current = false
      return
    }

    // Capture current input value before clearing
    const currentInput = input

    const optimisticId = `optimistic-${crypto.randomUUID()}`
    const optimisticAttachments =
      files.length > 0 ? createOptimisticAttachments(files) : []

    // Create optimistic message with v5 parts format (includes createdAt for app compatibility)
    const optimisticMessage: OptimisticUIMessage = {
      id: optimisticId,
      role: "user",
      createdAt: new Date(),
      parts: [
        { type: "text", text: currentInput },
        ...(optimisticAttachments.map((att) => ({
          type: "file" as const,
          filename: att.name,
          mediaType: att.contentType,
          url: att.url,
        }))),
      ],
    }

    setMessages((prev) => [...prev, optimisticMessage])
    setInput("")

    const submittedFiles = [...files]
    setFiles([])

    // Helper to extract file URLs from parts for cleanup
    const getFileUrlsFromParts = () =>
      optimisticMessage.parts
        ?.filter((p) => p.type === "file")
        .map((p) => ({ url: (p as { url?: string }).url })) || []

    try {
      const chatId = await ensureChatExists(user.id)
      if (!chatId) {
        setMessages((prev) => prev.filter((msg) => msg.id !== optimisticId))
        cleanupOptimisticAttachments(getFileUrlsFromParts())
        return
      }

      if (currentInput.length > MESSAGE_MAX_LENGTH) {
        toast({
          title: `The message you submitted was too long, please submit something shorter. (Max ${MESSAGE_MAX_LENGTH} characters)`,
          status: "error",
        })
        setMessages((prev) => prev.filter((msg) => msg.id !== optimisticId))
        cleanupOptimisticAttachments(getFileUrlsFromParts())
        return
      }

      let attachments: Attachment[] | null = []
      if (submittedFiles.length > 0) {
        attachments = await handleFileUploads(chatId)
        if (attachments === null) {
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
          cleanupOptimisticAttachments(getFileUrlsFromParts())
          return
        }
      }

      // Use sendMessage with text + file parts, options in second param
      sendMessage(
        {
          text: currentInput,
          files: attachments?.length
            ? convertAttachmentsToFiles(attachments)
            : undefined,
        },
        {
          body: {
            chatId,
            userId: user.id,
            model: selectedModel,
            isAuthenticated: true,
            systemPrompt: SYSTEM_PROMPT_DEFAULT,
            enableSearch,
          },
        }
      )

      setMessages((prev) => prev.filter((msg) => msg.id !== optimisticId))
      cleanupOptimisticAttachments(getFileUrlsFromParts())
      // Pass chatId explicitly to handle stale closures during chat creation
      cacheAndAddMessage(optimisticMessage, chatId)

      // Bump existing chats to top (non-blocking, after submit)
      if (messages.length > 0) {
        bumpChat(chatId)
      }
    } catch {
      setMessages((prev) => prev.filter((msg) => msg.id !== optimisticId))
      cleanupOptimisticAttachments(getFileUrlsFromParts())
      toast({ title: "Failed to send message", status: "error" })
    } finally {
      isSendingRef.current = false
      setIsSubmitting(false)
    }
  }, [
    user,
    files,
    createOptimisticAttachments,
    input,
    setMessages,
    setFiles,
    cleanupOptimisticAttachments,
    ensureChatExists,
    handleFileUploads,
    selectedModel,
    sendMessage,
    cacheAndAddMessage,
    messages.length,
    bumpChat,
    enableSearch,
  ])

  // Handle reload (regenerate)
  const handleReload = useCallback(async () => {
    if (!user?.id) {
      return
    }

    const options = {
      body: {
        chatId: null,
        userId: user.id,
        model: selectedModel,
        isAuthenticated: true,
        systemPrompt: SYSTEM_PROMPT_DEFAULT,
      },
    }

    regenerate(options)
  }, [user, selectedModel, regenerate])

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  // Memoize the conversation props to prevent unnecessary rerenders
  const conversationProps = useMemo(
    () => ({
      messages,
      status,
      onDelete: handleDelete,
      onEdit: handleEdit,
      onReload: handleReload,
      onStop: stop,
    }),
    [messages, status, handleDelete, handleEdit, handleReload, stop]
  )

  // Memoize the chat input props
  const chatInputProps = useMemo(
    () => ({
      defaultValue: input,
      onSuggestion: () => {},
      onValueChange: handleInputChange,
      onSend: submit,
      isSubmitting,
      files,
      onFileUpload: handleFileUpload,
      onFileRemove: handleFileRemove,
      hasSuggestions: false,
      onSelectModel: handleModelChange,
      selectedModel,
      isUserAuthenticated: isAuthenticated,
      stop,
      status,
      setEnableSearch,
      enableSearch,
    }),
    [
      input,
      handleInputChange,
      submit,
      isSubmitting,
      files,
      handleFileUpload,
      handleFileRemove,
      handleModelChange,
      selectedModel,
      isAuthenticated,
      stop,
      status,
      setEnableSearch,
      enableSearch,
    ]
  )

  // Always show onboarding when on project page, regardless of messages
  const showOnboarding = pathname === `/p/${projectId}`

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col items-center overflow-x-hidden overflow-y-auto",
        showOnboarding && chats.length === 0
          ? "justify-center pt-0"
          : showOnboarding && chats.length > 0
            ? "justify-start pt-32"
            : "justify-end"
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {showOnboarding ? (
          <motion.div
            key="onboarding"
            className="absolute bottom-[60%] mx-auto max-w-[50rem] md:relative md:bottom-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            layout="position"
            layoutId="onboarding"
            transition={{
              layout: {
                duration: 0,
              },
            }}
          >
            <div className="mb-6 flex items-center justify-center gap-2">
              <RiChat3Line size={24} className="size-6 text-muted-foreground" />
              <h1 className="text-center text-3xl font-medium tracking-tight text-balance">
                {project?.name || ""}
              </h1>
            </div>
          </motion.div>
        ) : (
          <Conversation key="conversation" {...conversationProps} />
        )}
      </AnimatePresence>

      <motion.div
        className={cn(
          "relative inset-x-0 bottom-0 z-50 mx-auto w-full max-w-3xl"
        )}
        layout="position"
        layoutId="chat-input-container"
        transition={{
          layout: {
            duration: messages.length === 1 ? 0.3 : 0,
          },
        }}
      >
        <ChatInput {...chatInputProps} />
      </motion.div>

      {showOnboarding && chats.length > 0 ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-20">
          <h2 className="text-muted-foreground mb-3 text-sm font-medium">
            Recent chats
          </h2>
          <div className="space-y-2">
            {chats.map((chat) => (
              <ProjectChatItem
                key={chat.id}
                chat={chat}
                formatDate={formatDate}
              />
            ))}
          </div>
        </div>
      ) : showOnboarding && chats.length === 0 ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-20">
          <h2 className="text-muted-foreground mb-3 text-sm font-medium">
            No chats yet
          </h2>
        </div>
      ) : null}
    </div>
  )
}
