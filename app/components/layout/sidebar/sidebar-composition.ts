import type { Doc } from "@/convex/_generated/dataModel"
import { isOptimisticChatId } from "@/lib/chat-store/identity"
import { sortByRecency } from "@/lib/chat-store/chats/sidebar-window"
import type { Chat } from "@/lib/chat-store/types"
import type { ChatOrganization } from "./chat-organization"

export type SidebarProjectModel = Doc<"projects"> & { pinned: boolean }

export type SidebarComposition = {
  pinnedChats: Chat[]
  pinnedProjects: SidebarProjectModel[]
  sectionProjects: SidebarProjectModel[]
  historyChats: Chat[]
  projectNames: ReadonlyMap<string, string>
}

/**
 * Resolve the sidebar's single selected chat row. The route remains the
 * authority for durable/local chats. On the new-chat surface only, bridge the
 * short interval where the chat store has inserted its optimistic first-turn
 * row but atomic creation has not handed navigation a durable chat id yet.
 */
export function deriveSidebarSelection({
  chats,
  pathname,
  routeChatId,
}: {
  chats: Chat[]
  pathname: string
  routeChatId?: string
}) {
  const optimisticChatId =
    routeChatId === undefined && pathname === "/"
      ? chats.find((chat) => isOptimisticChatId(chat.id))?.id
      : undefined
  const currentChatId = routeChatId ?? optimisticChatId

  return {
    currentChatId,
    isNewChatActive: pathname === "/" && currentChatId === undefined,
  }
}

export function deriveSidebarComposition({
  chats,
  projects,
  organization,
}: {
  chats: Chat[]
  projects: SidebarProjectModel[]
  organization: ChatOrganization
}): SidebarComposition {
  const pinnedChats = chats
    .filter((chat) => chat.pinned)
    .sort((a, b) => {
      const aTime = a.pinned_at ? +new Date(a.pinned_at) : 0
      const bTime = b.pinned_at ? +new Date(b.pinned_at) : 0
      return bTime - aTime
    })
  const nonPinnedChats = sortByRecency(chats.filter((chat) => !chat.pinned))
  const sortedProjects = [...projects].sort(
    (a, b) => b._creationTime - a._creationTime
  )
  const pinnedProjects = sortedProjects.filter((project) => project.pinned)
  const sectionProjects = sortedProjects.filter((project) => !project.pinned)
  const projectNames = new Map(
    projects.map((project) => [project._id as string, project.name])
  )

  return {
    pinnedChats,
    pinnedProjects,
    sectionProjects,
    historyChats:
      organization === "one-list"
        ? nonPinnedChats
        : nonPinnedChats.filter((chat) => !chat.project_id),
    projectNames,
  }
}
