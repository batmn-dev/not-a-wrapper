"use client"

import { ChatInput } from "@/app/components/chat-input/chat-input"
import { useFileUpload } from "@/app/components/chat/use-file-upload"
import { useModel } from "@/app/components/chat/use-model"
import { ProjectChatItem } from "@/app/components/layout/sidebar/project-chat-item"
import { Icon } from "@/components/ui/icon"
import { toast } from "@/components/ui/toast"
import { useChats } from "@/lib/chat-store/chats/provider"
import { MESSAGE_MAX_LENGTH, SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import {
  persistWebSearchToggle,
  resolveWebSearchEnabled,
} from "@/lib/user-preference-store/web-search"
import { useUser } from "@/lib/user-store/provider"
import { cn } from "@/lib/utils"
import { RiChat3Line } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

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
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [input, setInput] = useState("")
  const { preferences, setWebSearchEnabled } = useUserPreferences()
  const [enableSearch, setEnableSearchState] = useState(() =>
    resolveWebSearchEnabled(preferences.webSearchEnabled)
  )
  const { user } = useUser()
  const { chats: allChats, createNewChat } = useChats()
  const { files, setFiles, handleFileUpload, handleFileRemove } =
    useFileUpload()

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

  const chats = useMemo(
    () => allChats.filter((chat) => chat.project_id === projectId),
    [allChats, projectId]
  )
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

  const { selectedModel, handleModelChange } = useModel({
    currentChat: null,
    user,
    updateChatModel: () => Promise.resolve(),
    chatId: null,
  })

  const handleInputChange = useCallback((value: string) => {
    setInput(value)
  }, [])

  const submit = useCallback(async () => {
    if (isSubmitting) return

    const currentInput = input
    if (!/[^\s]/.test(currentInput)) return

    if (!user?.id) {
      toast({ title: "Please sign in and try again.", status: "error" })
      return
    }

    if (files.length > 0) {
      toast({
        title: "Open the project chat before attaching files.",
        status: "error",
      })
      return
    }

    if (currentInput.length > MESSAGE_MAX_LENGTH) {
      toast({
        title: `The message you submitted was too long, please submit something shorter. (Max ${MESSAGE_MAX_LENGTH} characters)`,
        status: "error",
      })
      return
    }

    setIsSubmitting(true)
    try {
      const newChat = await createNewChat(
        user.id,
        currentInput,
        selectedModel,
        true,
        SYSTEM_PROMPT_DEFAULT,
        projectId
      )
      if (!newChat) return

      setInput("")
      setFiles([])
      const chatParams = new URLSearchParams({
        prompt: currentInput,
        autoSubmit: "1",
      })
      router.push(`/c/${newChat.id}?${chatParams.toString()}`)
    } catch (error) {
      let errorMessage = "Something went wrong."
      if (error instanceof Error && error.message) {
        try {
          const parsed = JSON.parse(error.message) as { error?: string }
          errorMessage = parsed.error || errorMessage
        } catch {
          errorMessage = error.message
        }
      }
      toast({ title: errorMessage, status: "error" })
    } finally {
      setIsSubmitting(false)
    }
  }, [
    createNewChat,
    files.length,
    input,
    isSubmitting,
    projectId,
    router,
    selectedModel,
    setFiles,
    user?.id,
  ])

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
      stop: () => {},
      status: "ready" as const,
      setEnableSearch,
      enableSearch,
    }),
    [
      enableSearch,
      files,
      handleFileRemove,
      handleFileUpload,
      handleInputChange,
      handleModelChange,
      input,
      isAuthenticated,
      isSubmitting,
      selectedModel,
      setEnableSearch,
      submit,
    ]
  )

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col items-center overflow-x-hidden overflow-y-auto",
        chats.length === 0 ? "justify-center pt-0" : "justify-start pt-32"
      )}
    >
      <motion.div
        key="onboarding"
        className="absolute bottom-[60%] mx-auto max-w-[50rem] md:relative md:bottom-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        layout="position"
        layoutId="onboarding"
        transition={{
          layout: {
            duration: 0,
          },
        }}
      >
        <div className="mb-6 flex items-center justify-center gap-2">
          <Icon
            icon={RiChat3Line}
            slotSize={24}
            className="text-muted-foreground"
          />
          <h1 className="text-center text-3xl font-medium tracking-tight text-balance">
            {project?.name || ""}
          </h1>
        </div>
      </motion.div>

      <motion.div
        className="relative inset-x-0 bottom-0 z-50 mx-auto w-full max-w-3xl"
        layout="position"
        layoutId="chat-input-container"
        transition={{
          layout: {
            duration: 0,
          },
        }}
      >
        <ChatInput {...chatInputProps} />
      </motion.div>

      {chats.length > 0 ? (
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
      ) : (
        <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-20">
          <h2 className="text-muted-foreground mb-3 text-sm font-medium">
            No chats yet
          </h2>
        </div>
      )}
    </div>
  )
}
