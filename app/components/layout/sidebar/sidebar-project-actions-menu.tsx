"use client"

import { DialogDeleteProject } from "@/app/components/projects/dialog-delete-project"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import type { Id } from "@/convex/_generated/dataModel"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import {
  RiDeleteBinLine,
  RiEditLine,
  RiLoader4Line,
  RiMoreFill,
  RiPushpin2Line,
  RiUnpinFill,
} from "@remixicon/react"
import { useState } from "react"
import {
  trailingIconButtonClassName,
  TrailingIconChip,
} from "./trailing-icon-button"

type SidebarProjectActionsMenuProps = {
  project: {
    _id: Id<"projects">
    name: string
    pinned: boolean
  }
  onStartEditing: () => void
  onTogglePinned: () => void
  isPinPending?: boolean
}

/** Sidebar-only project actions; the Projects directory owns a separate menu. */
export function SidebarProjectActionsMenu({
  project,
  onStartEditing,
  onTogglePinned,
  isPinPending = false,
}: SidebarProjectActionsMenuProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const isMobile = useBreakpoint(768)
  const displayName = project.name || "Untitled Project"

  return (
    <span className="contents" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu modal={isMobile}>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={trailingIconButtonClassName}
              aria-label={`Open project options for ${displayName}`}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
            />
          }
        >
          <TrailingIconChip>
            <Icon icon={RiMoreFill} slotSize={20} />
          </TrailingIconChip>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-max">
          <DropdownMenuItem onClick={onStartEditing}>
            <Icon icon={RiEditLine} slotSize={20} />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onTogglePinned} disabled={isPinPending}>
            {isPinPending ? (
              <Icon
                icon={RiLoader4Line}
                slotSize={20}
                className="animate-spin"
              />
            ) : (
              <Icon
                icon={project.pinned ? RiUnpinFill : RiPushpin2Line}
                slotSize={20}
              />
            )}
            {project.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setIsDeleteDialogOpen(true)}
          >
            <Icon icon={RiDeleteBinLine} slotSize={20} />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DialogDeleteProject
        isOpen={isDeleteDialogOpen}
        setIsOpen={setIsDeleteDialogOpen}
        project={project}
      />
    </span>
  )
}
