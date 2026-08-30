"use client"

import {
  RowActionsMenu,
  type RowActionItem,
} from "@/app/components/layout/row-actions-menu"
import { DialogDeleteProject } from "@/app/components/projects/dialog-delete-project"
import { Icon } from "@/components/ui/icon"
import type { Id } from "@/convex/_generated/dataModel"
import {
  RiDeleteBinLine,
  RiEditLine,
  RiPushpin2Line,
  RiUnpinFill,
} from "@remixicon/react"
import { useState, type ReactElement } from "react"

type Project = {
  _id: Id<"projects">
  name: string
  pinned: boolean
}

type ProjectActionsMenuProps = {
  project: Project
  onStartEditing?: () => void
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
  presentation?: "default" | "directory"
}

// Project adapter over the Row-actions menu, owning its delete-confirmation
// dialog. Sidebar and directory surfaces share the shell while supplying only
// the actions each surface actually exposes.
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
  presentation = "default",
}: ProjectActionsMenuProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const isDirectory = presentation === "directory"
  const items: RowActionItem[] = [
    {
      key: "pin",
      icon: (
        <Icon
          icon={isPinned ? RiUnpinFill : RiPushpin2Line}
          slotSize={20}
        />
      ),
      label: isDirectory
        ? `${isPinned ? "Unpin" : "Pin"} project`
        : isPinned
          ? "Unpin"
          : "Pin",
      ariaLabel: `${isPinned ? "Unpin" : "Pin"} ${
        project.name || "Untitled Project"
      }`,
      onSelect: onTogglePinned,
      loading: isPinPending,
      disabled: isPinPending,
    },
  ]

  if (!isDirectory && onStartEditing) {
    items.push({
      key: "rename",
      icon: <Icon icon={RiEditLine} slotSize={20} />,
      label: "Rename",
      onSelect: onStartEditing,
    })
  }

  items.push({
    key: "delete",
    icon: <Icon icon={RiDeleteBinLine} slotSize={20} />,
    label: isDirectory ? "Delete project" : "Delete",
    variant: "destructive",
    separatorBefore: true,
    onSelect: () => setIsDeleteDialogOpen(true),
  })

  return (
    // Layout-neutral click boundary. The menu and dialog render in DOM portals
    // but stay React children of the host row's <Link>, and Next's Link
    // navigates from its React onClick — so a React-bubbled click from a
    // portaled surface (e.g. the delete dialog's confirm button) would
    // navigate the row. Stopping propagation here keeps every menu/dialog
    // interaction off the row link.
    <span className="contents" onClick={(event) => event.stopPropagation()}>
      <RowActionsMenu
        items={items}
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
