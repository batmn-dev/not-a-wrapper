"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import useClickOutside from "@/app/hooks/use-click-outside"
import { Icon } from "@/components/ui/icon"
import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
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
import { useCallback, useMemo, useRef, useState } from "react"
import { SidebarProjectMenu } from "./sidebar-project-menu"

type Project = {
  _id: Id<"projects">
  name: string
}

type SidebarProjectItemProps = {
  project: Project
}

export function SidebarProjectItem({ project }: SidebarProjectItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(project.name || "")
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [prevProjectName, setPrevProjectName] = useState(project.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const isMobile = useBreakpoint(768)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pathname = usePathname()
  const updateProjectName = useMutation(api.projects.updateName)

  // React 19 pattern: sync during render instead of useEffect
  if (!isEditing && project.name !== prevProjectName) {
    setPrevProjectName(project.name)
    setEditName(project.name || "")
  }

  const handleStartEditing = useCallback(() => {
    setIsEditing(true)
    setEditName(project.name || "")

    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    })
  }, [project.name])

  const handleSave = useCallback(async () => {
    if (editName.trim() !== project.name) {
      try {
        await updateProjectName({
          projectId: project._id,
          name: editName.trim(),
        })
      } catch (error) {
        toast({ title: "Failed to rename project", status: "error" })
        console.error("Failed to rename project:", error)
        // Still close edit state to avoid stuck UI
      }
    }
    setIsEditing(false)
    setIsMenuOpen(false)
  }, [project._id, project.name, editName, updateProjectName])

  const handleCancel = useCallback(() => {
    setEditName(project.name || "")
    setIsEditing(false)
    setIsMenuOpen(false)
  }, [project.name])

  const handleMenuOpenChange = useCallback((open: boolean) => {
    setIsMenuOpen(open)
  }, [])

  const handleClickOutside = useCallback(() => {
    if (isEditing) {
      handleSave()
    }
  }, [isEditing, handleSave])

  useClickOutside(containerRef, handleClickOutside)

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setEditName(e.target.value)
    },
    []
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        handleSave()
      } else if (e.key === "Escape") {
        e.preventDefault()
        handleCancel()
      }
    },
    [handleSave, handleCancel]
  )

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) {
        e.stopPropagation()
      }
    },
    [isEditing]
  )

  const handleSaveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleSave()
    },
    [handleSave]
  )

  const handleCancelClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleCancel()
    },
    [handleCancel]
  )

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
      onClick={handleContainerClick}
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
            value={editName}
            onChange={handleInputChange}
            className="text-primary max-h-full w-full bg-transparent text-sm focus:outline-none"
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <div className="flex gap-0.5">
            <button
              onClick={handleSaveClick}
              className="hover:bg-secondary text-muted-foreground hover:text-primary flex size-7 cursor-pointer items-center justify-center rounded-lg p-1"
              type="button"
            >
              <Icon icon={RiCheckLine} slotSize={16} />
            </button>
            <button
              onClick={handleCancelClick}
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
              onStartEditing={handleStartEditing}
              onMenuOpenChange={handleMenuOpenChange}
            />
          </div>
        </>
      )}
    </div>
  )
}
