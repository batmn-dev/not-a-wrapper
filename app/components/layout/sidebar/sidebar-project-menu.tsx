"use client"

import { DialogDeleteProject } from "@/app/components/layout/sidebar/dialog-delete-project"
import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import type { Id } from "@/convex/_generated/dataModel"
import { RiDeleteBinLine, RiEditLine, RiMoreFill } from "@remixicon/react"
import { useState } from "react"
import {
  trailingIconButtonClassName,
  TrailingIconChip,
} from "./trailing-icon-button"

type Project = {
  _id: Id<"projects">
  name: string
}

type SidebarProjectMenuProps = {
  project: Project
  onStartEditing: () => void
  onMenuOpenChange?: (open: boolean) => void
  triggerAriaLabel?: string
}

export function SidebarProjectMenu({
  project,
  onStartEditing,
  onMenuOpenChange,
  triggerAriaLabel,
}: SidebarProjectMenuProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const isMobile = useBreakpoint(768)

  return (
    <>
      <DropdownMenu
        // shadcn/ui pointer-events-none issue on mobile
        modal={isMobile ? true : false}
        onOpenChange={onMenuOpenChange}
      >
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={trailingIconButtonClassName}
              // Nested inside the row's <Link> now (no dead corners): cancel the
              // anchor's navigation and keep the click off the row.
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              aria-label={triggerAriaLabel ?? "Open project options"}
            />
          }
        >
          {/* Inherits the trigger's currentColor (tertiary→foreground) and hosts
              the keyboard focus ring on the inner chip. */}
          <TrailingIconChip>
            <Icon icon={RiMoreFill} slotSize={20} />
          </TrailingIconChip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onStartEditing()
            }}
          >
            <Icon icon={RiEditLine} slotSize={20} />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation()
              setIsDeleteDialogOpen(true)
            }}
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
    </>
  )
}
