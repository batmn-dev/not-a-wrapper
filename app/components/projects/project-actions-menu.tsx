"use client"

import { RowActionsMenu } from "@/app/components/layout/row-actions-menu"
import { DialogDeleteProject } from "@/app/components/projects/dialog-delete-project"
import { Icon } from "@/components/ui/icon"
import type { Id } from "@/convex/_generated/dataModel"
import {
  RiDeleteBinLine,
  RiEditLine,
  RiPushpin2Fill,
  RiPushpin2Line,
} from "@remixicon/react"
import { useState, type ReactElement } from "react"

type Project = {
  _id: Id<"projects">
  name: string
  pinned?: boolean
}

type ProjectActionsMenuProps = {
  project: Project
  onStartEditing: () => void
  onTogglePinned: () => void
  isPinned: boolean
  isPinPending?: boolean
  onMenuOpenChange?: (open: boolean) => void
  triggerAriaLabel?: string
  /**
   * Custom trigger element (with its own glyph children); falls back to the
   * shared sidebar ⋯ chip. Lets the sidebar row and the Projects directory row
   * share one menu while owning their own trigger styling.
   */
  trigger?: ReactElement
  contentAlign?: "start" | "center" | "end"
  contentSide?: "top" | "right" | "bottom" | "left"
}

// Project adapter over the Row-actions menu: Rename + Delete, owning its own
// delete-confirmation dialog. Shared by the sidebar project row and the
// /projects directory row so both surfaces get identical menu behavior.
export function ProjectActionsMenu({
  project,
  onStartEditing,
  onTogglePinned,
  isPinned,
  isPinPending = false,
  onMenuOpenChange,
  triggerAriaLabel,
  trigger,
  contentAlign = "start",
  contentSide = "bottom",
}: ProjectActionsMenuProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  return (
    // Layout-neutral click boundary. The menu and dialog render in DOM portals
    // but stay React children of the host row's <Link>, and Next's Link
    // navigates from its React onClick — so a React-bubbled click from a
    // portaled surface (e.g. the delete dialog's confirm button) would
    // navigate the row. Stopping propagation here keeps every menu/dialog
    // interaction off the row link.
    <span className="contents" onClick={(event) => event.stopPropagation()}>
      <RowActionsMenu
        items={[
          {
            key: "pin",
            icon: (
              <Icon
                icon={isPinned ? RiPushpin2Fill : RiPushpin2Line}
                slotSize={20}
              />
            ),
            label: isPinned ? "Unpin" : "Pin",
            ariaLabel: `${isPinned ? "Unpin" : "Pin"} ${
              project.name || "Untitled Project"
            }`,
            onSelect: onTogglePinned,
            loading: isPinPending,
            disabled: isPinPending,
          },
          {
            key: "rename",
            icon: <Icon icon={RiEditLine} slotSize={20} />,
            label: "Rename",
            onSelect: onStartEditing,
          },
          {
            key: "delete",
            icon: <Icon icon={RiDeleteBinLine} slotSize={20} />,
            label: "Delete",
            variant: "destructive",
            separatorBefore: true,
            onSelect: () => setIsDeleteDialogOpen(true),
          },
        ]}
        trigger={trigger}
        triggerAriaLabel={triggerAriaLabel ?? "Open project options"}
        onOpenChange={onMenuOpenChange}
        contentSide={contentSide}
        contentAlign={contentAlign}
      />

      <DialogDeleteProject
        isOpen={isDeleteDialogOpen}
        setIsOpen={setIsDeleteDialogOpen}
        project={project}
      />
    </span>
  )
}
