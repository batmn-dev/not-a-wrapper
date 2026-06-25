"use client"

import { Icon } from "@/components/ui/icon"
import { api } from "@/convex/_generated/api"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { RiFolderAddFill, RiFolderAddLine } from "@remixicon/react"
import { useState } from "react"
import { DialogCreateProject } from "./dialog-create-project"
import { SidebarMenuItem } from "./sidebar-menu-item"
import { SidebarProjectItem } from "./sidebar-project-item"

type SidebarProjectProps = {
  isAuthenticated: boolean
}

export function SidebarProject({ isAuthenticated }: SidebarProjectProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  // Subscription gated on Convex auth readiness by the Per-user subscription
  // seam; the `isAuthenticated` prop (WorkOS) only hides the section for guests.
  const { data: projects } = usePerUserQuery(api.projects.getForCurrentUser)
  const isLoading = projects === undefined

  if (!isAuthenticated) return null

  return (
    <div className="mb-5">
      <SidebarMenuItem
        icon={<Icon icon={RiFolderAddLine} slotSize={20} />}
        activeIcon={<Icon icon={RiFolderAddFill} slotSize={20} />}
        label="New project"
        onClick={() => setIsDialogOpen(true)}
        isActive={isDialogOpen}
      />

      {isLoading ? null : (
        <div className="flex flex-col">
          {projects?.map((project) => (
            <SidebarProjectItem key={project._id} project={project} />
          ))}
        </div>
      )}

      <DialogCreateProject isOpen={isDialogOpen} setIsOpen={setIsDialogOpen} />
    </div>
  )
}
