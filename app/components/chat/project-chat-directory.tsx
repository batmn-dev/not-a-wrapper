"use client"

import { ProjectChatItem } from "@/app/components/layout/sidebar/project-chat-item"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { convexChatToChat } from "@/lib/chat-store/types"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { useMemo } from "react"

/**
 * The project surface's chat directory, rendered under the Composer while the
 * Chat surface is in project onboarding (no chat route yet). Shows ALL of the
 * project's chats via a dedicated owner-checked read, not the bounded sidebar
 * window. See docs/adr/0005-bounded-chat-list-window.md.
 */
export function ProjectChatDirectory({
  projectId,
}: {
  projectId: Id<"projects">
}) {
  const { data: projectChats } = usePerUserQuery(
    api.chats.getProjectChatsForCurrentUser,
    { projectId }
  )
  const chats = useMemo(
    () => projectChats?.map(convexChatToChat),
    [projectChats]
  )

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  if (chats === undefined) return null

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-20">
      <h2 className="text-muted-foreground mb-3 text-sm font-medium">
        {chats.length > 0 ? "Recent chats" : "No chats yet"}
      </h2>
      {chats.length > 0 ? (
        <div className="space-y-2">
          {chats.map((chat) => (
            <ProjectChatItem key={chat.id} chat={chat} formatDate={formatDate} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
