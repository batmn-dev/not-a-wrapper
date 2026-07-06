"use client"

import {
  Composer,
  type ComposerTurnPayload,
} from "@/app/components/chat-input/composer"
import {
  TurnContextProvider,
  useTurnContext,
} from "@/app/components/chat/turn-context"
import { ProjectChatItem } from "@/app/components/layout/sidebar/project-chat-item"
import { Icon } from "@/components/ui/icon"
import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useChats } from "@/lib/chat-store/chats/provider"
import { convexChatToChat } from "@/lib/chat-store/types"
import { MESSAGE_MAX_LENGTH } from "@/lib/config"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { useUser } from "@/lib/user-store/provider"
import { cn } from "@/lib/utils"
import { RiChat3Line } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import { useRouter } from "next/navigation"
import { useCallback, useMemo, useState } from "react"

type Project = {
  id: string
  name: string
  user_id: string
  created_at: string
}

type ProjectViewProps = {
  projectId: string
}

/**
 * ProjectView hosts its own Turn context (no chat yet — model resolution runs
 * with chatId null) so the Composer's picker and search toggle read the same
 * module the chat surface uses.
 */
export function ProjectView({ projectId }: ProjectViewProps) {
  return (
    <TurnContextProvider chatId={null} currentChat={null}>
      <ProjectViewInner projectId={projectId} />
    </TurnContextProvider>
  )
}

function ProjectViewInner({ projectId }: ProjectViewProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { user } = useUser()
  const { createNewChat } = useChats()
  const { getTurnSnapshot } = useTurnContext()

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

  // The project shows ALL its chats via a dedicated owner-checked read, not the
  // bounded sidebar window. See docs/adr/0005-bounded-chat-list-window.md.
  const { data: projectChats } = usePerUserQuery(
    api.chats.getProjectChatsForCurrentUser,
    { projectId: projectId as Id<"projects"> }
  )
  const chats = useMemo(
    () => projectChats?.map(convexChatToChat),
    [projectChats]
  )
  const hasProjectChats = (chats?.length ?? 0) > 0
  const shouldShowEmptyState = chats !== undefined && chats.length === 0

  const handleTurn = useCallback(
    async ({ text, files }: ComposerTurnPayload): Promise<boolean> => {
      if (isSubmitting) return false
      if (!/[^\s]/.test(text)) return false

      if (!user?.id) {
        toast({ title: "Please sign in and try again.", status: "error" })
        return false
      }

      if (files.length > 0) {
        toast({
          title: "Open the project chat before attaching files.",
          status: "error",
        })
        return false
      }

      if (text.length > MESSAGE_MAX_LENGTH) {
        toast({
          title: `The message you submitted was too long, please submit something shorter. (Max ${MESSAGE_MAX_LENGTH} characters)`,
          status: "error",
        })
        return false
      }

      setIsSubmitting(true)
      try {
        // Read turn inputs at run time from the Turn context snapshot — never
        // from a render-time closure.
        const turnSnapshot = getTurnSnapshot()
        const newChat = await createNewChat(
          user.id,
          text,
          turnSnapshot.selectedModel,
          true,
          turnSnapshot.systemPrompt,
          projectId
        )
        if (!newChat) return false

        const chatParams = new URLSearchParams({
          prompt: text,
          autoSubmit: "1",
        })
        router.push(`/c/${newChat.id}?${chatParams.toString()}`)
        return true
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
        return false
      } finally {
        setIsSubmitting(false)
      }
    },
    [createNewChat, getTurnSnapshot, isSubmitting, projectId, router, user?.id]
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
        hasProjectChats ? "justify-start pt-32" : "justify-center pt-0"
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
        <Composer
          chatId={null}
          draftScopeId={`project-${projectId}`}
          onTurn={handleTurn}
          isSubmitting={isSubmitting}
          status="ready"
        />
      </motion.div>

      {chats !== undefined && chats.length > 0 ? (
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
      ) : shouldShowEmptyState ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-20">
          <h2 className="text-muted-foreground mb-3 text-sm font-medium">
            No chats yet
          </h2>
        </div>
      ) : null}
    </div>
  )
}
