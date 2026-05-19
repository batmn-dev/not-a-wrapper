"use client"

import { api } from "@/convex/_generated/api"
import { RiFolderAddLine } from "@remixicon/react"
import { useQuery } from "convex/react"
import { useState } from "react"
import { DialogCreateProject } from "./dialog-create-project"
import { SidebarMenuItem } from "./sidebar-menu-item"
import { SidebarProjectItem } from "./sidebar-project-item"

type SidebarProjectProps = {
  isAuthenticated: boolean
}

export function SidebarProject({ isAuthenticated }: SidebarProjectProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const projects = useQuery(
    api.projects.getForCurrentUser,
    isAuthenticated ? {} : "skip"
  )
  const isLoading = projects === undefined

  if (!isAuthenticated) return null

  return (
    <div className="mb-5">
      <SidebarMenuItem
        icon={<RiFolderAddLine size={20} className="size-5" />}
        label="New project"
        onClick={() => setIsDialogOpen(true)}
      />

      {isLoading ? null : (
        <div className="space-y-1">
          {projects?.map((project) => (
            <SidebarProjectItem key={project._id} project={project} />
          ))}
        </div>
      )}

      <DialogCreateProject isOpen={isDialogOpen} setIsOpen={setIsDialogOpen} />
    </div>
  )
}
