"use client"

import { DialogCreateProject } from "@/app/components/projects/dialog-create-project"
import { useProjectPinning } from "@/app/components/projects/use-project-pinning"
import { Icon } from "@/components/ui/icon"
import { useSidebar } from "@/components/ui/sidebar"
import { api } from "@/convex/_generated/api"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { RiAddLine, RiFolderFill, RiFolderLine } from "@remixicon/react"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { SidebarMenuItem } from "./sidebar-menu-item"
import { SidebarProjectItem } from "./sidebar-project-item"

type SidebarProjectProps = {
  isAuthenticated: boolean
}

export function SidebarProject({ isAuthenticated }: SidebarProjectProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  // Subscription gated on Convex auth readiness by the Per-user subscription
  // seam; the `isAuthenticated` prop (WorkOS) only hides the section for guests.
  const { data: projects } = usePerUserQuery(api.projects.getForCurrentUser)
  const isLoading = projects === undefined
  const projectPinning = useProjectPinning()

  if (!isAuthenticated) return null

  const isDirectoryActive = pathname === "/projects"

  return (
    <div className="mb-5">
      {/* "Projects" is a real navigation destination (the /projects directory),
          with the new-project affordance moved into a hover/focus-revealed
          trailing "+" — mirroring ChatGPT's sidebar-item-projects row. */}
      <SidebarMenuItem
        icon={<Icon icon={RiFolderLine} slotSize={20} />}
        activeIcon={<Icon icon={RiFolderFill} slotSize={20} />}
        label="Projects"
        href="/projects"
        testId="sidebar-item-projects"
        isActive={isDirectoryActive}
        onClick={() => setOpenMobile(false)}
        trailingInteractive
        trailing={
          <button
            type="button"
            aria-label="New project"
            className="sidebar-group-header-action hover:text-foreground active:text-foreground focus-visible:text-foreground -my-2 -me-1.5 flex h-9 w-[34px] shrink-0 items-center justify-center text-[var(--text-tertiary)] outline-none"
            onClick={(event) => {
              // Nested inside the row <Link>: cancel the navigation and keep the
              // click off the row before opening the create dialog.
              event.preventDefault()
              event.stopPropagation()
              setIsDialogOpen(true)
            }}
          >
            <span className="sidebar-group-header-action-chip flex size-6 items-center justify-center rounded-[8px]">
              <Icon icon={RiAddLine} slotSize={20} />
            </span>
          </button>
        }
      />

      {isLoading ? null : (
        <div className="flex flex-col">
          {projects
            ?.map((project) => ({
              ...project,
              pinned: projectPinning.isPinned(project),
            }))
            .sort(
              (a, b) =>
                Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
                b._creationTime - a._creationTime
            )
            .map((project) => (
              <SidebarProjectItem
                key={project._id}
                project={project}
                isPinPending={projectPinning.isPinPending(project._id)}
                onTogglePinned={() => projectPinning.togglePinned(project)}
              />
            ))}
        </div>
      )}

      <DialogCreateProject isOpen={isDialogOpen} setIsOpen={setIsDialogOpen} />
    </div>
  )
}
