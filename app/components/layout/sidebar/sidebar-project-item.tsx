"use client"

import { useRenameProject } from "@/app/components/projects/use-rename-project"
import type { Id } from "@/convex/_generated/dataModel"
import { RiFolderFill, RiFolderLine } from "@remixicon/react"
import { usePathname } from "next/navigation"
import { SidebarProjectActionsMenu } from "./sidebar-project-actions-menu"
import { SidebarRow } from "./sidebar-row"
import { SidebarRowActions } from "./sidebar-row-actions"
import { SidebarPinAction } from "./trailing-icon-button"

type Project = {
  _id: Id<"projects">
  name: string
  pinned?: boolean
}

type SidebarProjectItemProps = {
  project: Project
  isPinPending?: boolean
  onTogglePinned: () => void
}

// Link-only project adapter over the Sidebar row module. Its narrow props keep
// project navigation independent from chat previews or disclosure state.
export function SidebarProjectItem({
  project,
  isPinPending,
  onTogglePinned,
}: SidebarProjectItemProps) {
  const pathname = usePathname()
  const renameProject = useRenameProject()

  const isActive = pathname.startsWith(`/p/${project._id}`)
  const displayName = project.name || "Untitled Project"

  return (
    <SidebarRow
      interaction={{ kind: "link", href: `/p/${project._id}` }}
      isActive={isActive}
      ariaLabel={`${displayName}, project`}
      title={displayName}
      renameValue={project.name || ""}
      renameLabel="Project title"
      onRename={(next) => renameProject(project._id, next)}
      leadingIcon={RiFolderLine}
      activeLeadingIcon={RiFolderFill}
      trailing={({ startRename }) => (
        <SidebarRowActions strategy="overlay" key={project._id}>
          <SidebarPinAction
            pinned={project.pinned ?? false}
            title={displayName}
            itemType="Project"
            onTogglePinned={onTogglePinned}
            isPending={isPinPending}
          />
          <SidebarProjectActionsMenu
            project={project}
            onStartEditing={startRename}
            onTogglePinned={onTogglePinned}
            isPinPending={isPinPending}
          />
        </SidebarRowActions>
      )}
    />
  )
}
