"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
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
  const isMobile = useBreakpoint(768)
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
  const isActive = useMemo(
    () => pathname.startsWith(`/p/${project._id}`) || isEditing || isMenuOpen,
    [pathname, project._id, isEditing, isMenuOpen]
  )

  const displayName = useMemo(
    () => project.name || "Untitled Project",
    [project.name]
  )

  const containerClassName = useMemo(
    () =>
      cn(
        "menu-item-hoverable hover:bg-accent/80 hover:text-foreground group/project relative mx-1.5 h-9 w-[calc(100%-var(--spacing)*3)] cursor-pointer rounded-lg",
        isActive &&
          "bg-accent hover:bg-accent text-foreground group-data-[collapsible=icon]:bg-transparent"
      ),
    [isActive]
  )

  const menuClassName = useMemo(
    () =>
      cn(
        "absolute top-0 right-1 flex h-full items-center justify-center opacity-0 group-hover/project:opacity-100",
        isMobile && "opacity-100 group-hover/project:opacity-100"
      ),
    [isMobile]
  )

  return (
    <div
      className={containerClassName}
      onClick={onContainerClick}
      ref={containerRef}
    >
      {isEditing ? (
        <div className="flex h-full items-center rounded-lg py-[3px] pr-1 pl-2">
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
      ) : (
        <>
          <Link
            href={`/p/${project._id}`}
            className="block h-full w-full cursor-pointer"
            prefetch
            onClick={handleLinkClick}
          >
            <div
              className="text-primary relative line-clamp-1 flex h-full w-full items-center gap-2 mask-r-from-80% mask-r-to-85% px-2.5 py-1.5 text-sm text-ellipsis whitespace-nowrap"
              title={displayName}
            >
              <Icon
                icon={isActive ? RiFolderFill : RiFolderLine}
                slotSize={20}
              />
              {displayName}
            </div>
          </Link>

          <div className={menuClassName} key={project._id}>
            <SidebarProjectMenu
              project={project}
              onStartEditing={start}
              onMenuOpenChange={handleMenuOpenChange}
            />
          </div>
        </>
      )}
    </div>
  )
}
