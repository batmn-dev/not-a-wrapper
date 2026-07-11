"use client"

import { Icon } from "@/components/ui/icon"
import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { RiFolderFill, RiFolderLine } from "@remixicon/react"
import { useMutation } from "convex/react"
import { usePathname } from "next/navigation"
import { SidebarProjectMenu } from "./sidebar-project-menu"
import { SidebarRow } from "./sidebar-row"

type Project = {
  _id: Id<"projects">
  name: string
}

type SidebarProjectItemProps = {
  project: Project
}

// Project adapter over the Sidebar row module: supplies the project href/active
// predicate, the folder leading glyph, the name-rename mutation, and the
// project actions trailing.
export function SidebarProjectItem({ project }: SidebarProjectItemProps) {
  const pathname = usePathname()
  const updateProjectName = useMutation(api.projects.updateName)

  const isActive = pathname.startsWith(`/p/${project._id}`)
  const displayName = project.name || "Untitled Project"

  return (
    <SidebarRow
      href={`/p/${project._id}`}
      isActive={isActive}
      title={displayName}
      renameValue={project.name || ""}
      renameLabel="Project title"
      onRename={async (next) => {
        try {
          await updateProjectName({ projectId: project._id, name: next })
        } catch (error) {
          toast({ title: "Failed to rename project", status: "error" })
          console.error("Failed to rename project:", error)
        }
      }}
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
          <SidebarProjectMenu
            project={project}
            onStartEditing={startRename}
            triggerAriaLabel={`Open project options for ${displayName}`}
          />
        </div>
      )}
    />
  )
}
