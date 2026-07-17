"use client"

import { useRenameProject } from "@/app/components/projects/use-rename-project"
import { Icon } from "@/components/ui/icon"
import { useSidebar } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Id } from "@/convex/_generated/dataModel"
import type { Chat } from "@/lib/chat-store/types"
import { RiAddLine, RiFolderFill, RiFolderLine } from "@remixicon/react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useSyncExternalStore } from "react"
import type { SidebarProjectPreview } from "./sidebar-composition"
import { SidebarItem } from "./sidebar-item"
import { SidebarProjectActionsMenu } from "./sidebar-project-actions-menu"
import { SidebarRow } from "./sidebar-row"
import { SidebarRowActions } from "./sidebar-row-actions"
import { SidebarSecondaryAction } from "./trailing-icon-button"

type Project = {
  _id: Id<"projects">
  name: string
  pinned?: boolean
}

type SidebarProjectItemProps = {
  project: Project
  isPinPending?: boolean
  onTogglePinned: () => void
  preview?: SidebarProjectPreview
  currentChatId?: string
  activeProjectId?: string
}

// Project adapter over the Sidebar row module: supplies the project href/active
// predicate, the folder leading glyph, the name-rename mutation, and the
// project actions trailing.
export function SidebarProjectItem({
  project,
  isPinPending,
  onTogglePinned,
  preview,
  currentChatId = "",
  activeProjectId,
}: SidebarProjectItemProps) {
  const pathname = usePathname()
  const renameProject = useRenameProject()
  const { setOpenMobile } = useSidebar()
  const chats: Chat[] = preview?.chats ?? []

  const isActive = pathname.startsWith(`/p/${project._id}`)
  const containsActiveChat = project._id === activeProjectId
  const displayName = project.name || "Untitled Project"
  const disclosureId = `sidebar-project-${project._id}-chats`
  const storageKey = `sidebar-project-${project._id}-open`
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const handleStorage = (event: StorageEvent) => {
        if (event.key === storageKey) onStoreChange()
      }
      window.addEventListener("storage", handleStorage)
      return () => window.removeEventListener("storage", handleStorage)
    },
    [storageKey]
  )
  const getSnapshot = useCallback(
    () => localStorage.getItem(storageKey) === "true",
    [storageKey]
  )
  const storedOpen = useSyncExternalStore(subscribe, getSnapshot, () => false)
  const isOpen = isActive || containsActiveChat || storedOpen
  const previewChats = chats.slice(0, 5)

  const toggleOpen = () => {
    const next = !isOpen
    localStorage.setItem(storageKey, String(next))
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey }))
  }

  return (
    <div>
      <SidebarRow
        interaction={{
          kind: "disclosure",
          expanded: isOpen,
          controls: disclosureId,
          onToggle: toggleOpen,
        }}
        isActive={isActive}
        ariaLabel={`${displayName}, project`}
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
          <SidebarRowActions strategy="overlay" key={project._id}>
            <SidebarSecondaryAction
              pinned={project.pinned ?? false}
              title={displayName}
              itemType="Project"
              onTogglePinned={onTogglePinned}
              isPending={isPinPending}
              unpinnedAction={
                <Tooltip disableHoverablePopup>
                  <TooltipTrigger
                    render={
                      <Link
                        href={`/p/${project._id}`}
                        aria-label="Open project home"
                        className="hover:text-foreground flex h-9 items-center justify-center text-[var(--text-tertiary)] outline-none"
                        onClick={() => setOpenMobile(false)}
                      />
                    }
                  >
                    <span className="trailing-icon-chip flex size-6 items-center justify-center rounded-md">
                      <Icon icon={RiAddLine} slotSize={20} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={-14}
                    variant="outline"
                    className="text-sm font-normal"
                  >
                    New Chat
                  </TooltipContent>
                </Tooltip>
              }
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
      {isOpen ? (
        <div id={disclosureId} role="group" aria-label={`${displayName} chats`}>
          {previewChats.map((chat) => (
            <SidebarItem
              key={chat.id}
              chat={chat}
              currentChatId={currentChatId}
              presentation={{ kind: "nested", projectName: displayName }}
            />
          ))}
          {preview?.hasMore ? (
            <Link
              href={`/p/${project._id}`}
              className="sidebar-row sidebar-menu-row sidebar-row-nested sidebar-row-content text-foreground flex items-center text-sm hover:bg-[var(--sidebar-row-active-background)] focus-visible:outline-none"
              onClick={() => setOpenMobile(false)}
            >
              Show more
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
