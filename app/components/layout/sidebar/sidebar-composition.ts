import type { Doc } from "@/convex/_generated/dataModel"
import { sortByRecency } from "@/lib/chat-store/chats/sidebar-window"
import type { Chat } from "@/lib/chat-store/types"
import type { ChatOrganization } from "./chat-organization"

export type SidebarProjectModel = Doc<"projects"> & { pinned: boolean }
export type SidebarProjectPreview = {
  chats: Chat[]
  hasMore: boolean
}

export type SidebarComposition = {
  pinnedChats: Chat[]
  pinnedProjects: SidebarProjectModel[]
  sectionProjects: SidebarProjectModel[]
  historyChats: Chat[]
  projectPreviews: ReadonlyMap<string, SidebarProjectPreview>
  projectNames: ReadonlyMap<string, string>
}

export function deriveSidebarComposition({
  chats,
  projects,
  projectPreviews,
  organization,
}: {
  chats: Chat[]
  projects: SidebarProjectModel[]
  projectPreviews: ReadonlyMap<string, SidebarProjectPreview>
  organization: ChatOrganization
}): SidebarComposition {
  const pinnedProjectIds = new Set(
    projects
      .filter((project) => project.pinned)
      .map((project) => project._id as string)
  )
  const pinnedChats = chats
    .filter((chat) => {
      if (!chat.pinned) return false
      if (!chat.project_id) return true

      // By-project keeps every project chat under its owning project. In the
      // combined mode a pinned project chat may surface globally, except when
      // its pinned parent already renders in the same Pinned section.
      return (
        organization === "one-list" && !pinnedProjectIds.has(chat.project_id)
      )
    })
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
        ? nonPinnedChats.filter(
            (chat) => !chat.project_id || !pinnedProjectIds.has(chat.project_id)
          )
        : nonPinnedChats.filter((chat) => !chat.project_id),
    projectPreviews,
    projectNames,
  }
}
