"use client"

import { Icon } from "@/components/ui/icon"
import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useInlineRename } from "@/hooks/use-inline-rename"
import { cn } from "@/lib/utils"
import {
  RiCheckLine,
  RiCloseLine,
  RiFolderFill,
  RiFolderLine,
} from "@remixicon/react"
import { useMutation } from "convex/react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useMemo, useState } from "react"
import { SidebarProjectMenu } from "./sidebar-project-menu"

type Project = {
  _id: Id<"projects">
  name: string
}

type SidebarProjectItemProps = {
  project: Project
}

export function SidebarProjectItem({ project }: SidebarProjectItemProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const pathname = usePathname()
  const updateProjectName = useMutation(api.projects.updateName)

  const {
    isEditing,
    start,
    inputRef,
    containerRef,
    inputProps,
    onContainerClick,
    onSaveClick,
    onCancelClick,
  } = useInlineRename(
    project.name || "",
    async (next) => {
      try {
        await updateProjectName({ projectId: project._id, name: next })
      } catch (error) {
        toast({ title: "Failed to rename project", status: "error" })
        console.error("Failed to rename project:", error)
        // Still close edit state to avoid stuck UI (handled by the hook)
      }
    },
    { onEditEnd: () => setIsMenuOpen(false) }
  )

  const handleMenuOpenChange = useCallback((open: boolean) => {
    setIsMenuOpen(open)
  }, [])

  const handleLinkClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  // Memoize computed values
  const isCurrentProject = useMemo(
    () => pathname.startsWith(`/p/${project._id}`),
    [pathname, project._id]
  )

  const isActive = useMemo(
    () => isCurrentProject || isEditing || isMenuOpen,
    [isCurrentProject, isEditing, isMenuOpen]
  )

  const displayName = useMemo(
    () => project.name || "Untitled Project",
    [project.name]
  )

  const containerClassName = useMemo(
    () =>
      cn(
        // Same recipe as the chat row (sidebar-item): hover == selected ==
        // menu-open off the one translucent token; single flex row.
        "sidebar-row menu-item-hoverable hover:bg-[var(--sidebar-row-active-background)] hover:text-foreground group/project relative mx-1.5 flex h-9 w-[calc(100%-var(--spacing)*3)] items-center rounded-lg pointer-coarse:h-auto",
        isActive &&
          "bg-[var(--sidebar-row-active-background)] hover:bg-[var(--sidebar-row-active-background)] text-foreground group-data-[collapsible=icon]:bg-transparent"
      ),
    [isActive]
  )

  // Rename mode keeps the plain <div> container (it needs containerRef for
  // click-outside-commits and swaps the row for an input).
  if (isEditing) {
    return (
      <div
        className={containerClassName}
        onClick={onContainerClick}
        ref={containerRef}
      >
        <div className="flex h-full w-full items-center rounded-lg py-[3px] pr-1 pl-2">
          <Icon
            icon={RiFolderFill}
            slotSize={20}
            className="text-primary mr-2 flex-shrink-0"
          />
          <input
            ref={inputRef}
            {...inputProps}
            className="text-primary max-h-full w-full bg-transparent text-base focus:outline-none"
          />
          <div className="flex gap-0.5">
            <button
              onClick={onSaveClick}
              className="hover:bg-secondary text-muted-foreground hover:text-primary flex size-7 cursor-pointer items-center justify-center rounded-lg p-1"
              type="button"
            >
              <Icon icon={RiCheckLine} slotSize={16} />
            </button>
            <button
              onClick={onCancelClick}
              className="hover:bg-secondary text-muted-foreground hover:text-primary flex size-7 cursor-pointer items-center justify-center rounded-lg p-1"
              type="button"
            >
              <Icon icon={RiCloseLine} slotSize={16} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Resting/nav mode: the <Link> IS the whole row (ChatGPT's single `<a>`), with
  // the folder icon, name, and the trailing menu nested INSIDE it — no absolute
  // sibling, no mask fade, no dead corners. The nested trigger stops propagation
  // so activating it opens the menu without navigating, and the reveal-by-reflow
  // action (globals.css) keeps the button visible while the menu is open.
  return (
    <Link
      href={`/p/${project._id}`}
      className={cn(
        containerClassName,
        "text-primary px-2.5 py-1.5 text-sm focus-visible:outline-none pointer-coarse:py-3"
      )}
      prefetch
      draggable={false}
      onClick={handleLinkClick}
      aria-current={isCurrentProject ? "page" : undefined}
      title={displayName}
    >
      <div className="flex min-w-0 grow items-center gap-2">
        <Icon
          icon={isActive ? RiFolderFill : RiFolderLine}
          slotSize={20}
          className="shrink-0"
        />
        <span className="truncate">{displayName}</span>
      </div>

      <div className="sidebar-row-action flex h-full items-center" key={project._id}>
        <SidebarProjectMenu
          project={project}
          onStartEditing={start}
          onMenuOpenChange={handleMenuOpenChange}
          triggerAriaLabel={`Open project options for ${displayName}`}
        />
      </div>
    </Link>
  )
}
