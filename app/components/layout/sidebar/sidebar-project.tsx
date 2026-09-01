"use client"

import { DialogCreateProject } from "@/app/components/projects/dialog-create-project"
import { CollapsibleSection } from "@/components/ui/collapsible-section"
import { Icon } from "@/components/ui/icon"
import { useSidebar } from "@/components/ui/sidebar"
import type { Id } from "@/convex/_generated/dataModel"
import {
  RiAddLine,
  RiFolderAddLine,
  RiFolderLine,
  RiFolderOpenFill,
} from "@remixicon/react"
import { usePathname } from "next/navigation"
import { useState } from "react"
import type { ChatOrganization } from "./chat-organization"
import { SidebarCollection, SidebarCollectionItem } from "./sidebar-collection"
import type { SidebarProjectModel } from "./sidebar-composition"
import { SidebarChatGroupActions } from "./sidebar-list"
import { SidebarMenuItem } from "./sidebar-menu-item"
import { SidebarProjectItem } from "./sidebar-project-item"

type SidebarProjectProps = {
  isAuthenticated: boolean
  organization: ChatOrganization
  projects: SidebarProjectModel[]
  isPinPending: (projectId: Id<"projects">) => boolean
  onTogglePinned: (project: SidebarProjectModel) => void
  onOrganizationChange: (organization: ChatOrganization) => void
}

export function SidebarProject({
  isAuthenticated,
  organization,
  projects,
  isPinPending,
  onTogglePinned,
  onOrganizationChange,
}: SidebarProjectProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()

  if (!isAuthenticated) return null

  const isDirectoryActive = pathname === "/projects"
  return (
    <>
      {organization === "one-list" ? (
        <SidebarMenuItem
          icon={RiFolderLine}
          activeIcon={RiFolderOpenFill}
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
      ) : (
        <CollapsibleSection
          title="Projects"
          storageKey="sidebar-section-projects"
          variant="sidebar"
          headerActions={
            <SidebarChatGroupActions
              organization={organization}
              onOrganizationChange={onOrganizationChange}
              onNewProject={() => setIsDialogOpen(true)}
            />
          }
        >
          <SidebarCollection>
            {projects.length === 0 ? (
              <SidebarCollectionItem>
                <SidebarMenuItem
                  icon={RiFolderAddLine}
                  label="New project"
                  testId="sidebar-new-project"
                  onClick={() => setIsDialogOpen(true)}
                />
              </SidebarCollectionItem>
            ) : (
              projects.map((project) => (
                <SidebarCollectionItem key={project._id}>
                  <SidebarProjectItem
                    project={project}
                    isPinPending={isPinPending(project._id)}
                    onTogglePinned={() => onTogglePinned(project)}
                  />
                </SidebarCollectionItem>
              ))
            )}
          </SidebarCollection>
        </CollapsibleSection>
      )}

      <DialogCreateProject isOpen={isDialogOpen} setIsOpen={setIsDialogOpen} />
    </>
  )
}
