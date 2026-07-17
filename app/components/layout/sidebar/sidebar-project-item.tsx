"use client"

import { ProjectActionsMenu } from "@/app/components/projects/project-actions-menu"
import { useRenameProject } from "@/app/components/projects/use-rename-project"
import { Icon } from "@/components/ui/icon"
import type { Id } from "@/convex/_generated/dataModel"
import { RiFolderFill, RiFolderLine } from "@remixicon/react"
import { usePathname } from "next/navigation"
import { SidebarRow } from "./sidebar-row"

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

// Project adapter over the Sidebar row module: supplies the project href/active
// predicate, the folder leading glyph, the name-rename mutation, and the
// project actions trailing.
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
      href={`/p/${project._id}`}
      isActive={isActive}
      title={displayName}
      renameValue={project.name || ""}
      renameLabel="Project title"
      onRename={(next) => renameProject(project._id, next)}
      leading={
        <Icon
          icon={isActive ? RiFolderFill : RiFolderLine}
          slotSize={20}
          className="shrink-0"
        />
      }
      trailing={({ startRename }) => (
        <div
          className="sidebar-row-action flex h-full items-center"
          key={project._id}
        >
          <ProjectActionsMenu
            project={project}
            onStartEditing={startRename}
            onTogglePinned={onTogglePinned}
            isPinned={Boolean(project.pinned)}
            isPinPending={isPinPending}
            triggerAriaLabel={`Open project options for ${displayName}`}
          />
        </div>
      )}
    />
  )
}
