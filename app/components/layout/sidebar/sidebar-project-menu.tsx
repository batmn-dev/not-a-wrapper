"use client"

import { RowActionsMenu } from "@/app/components/layout/row-actions-menu"
import { DialogDeleteProject } from "@/app/components/layout/sidebar/dialog-delete-project"
import { Icon } from "@/components/ui/icon"
import type { Id } from "@/convex/_generated/dataModel"
import { RiDeleteBinLine, RiEditLine } from "@remixicon/react"
import { useState } from "react"

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

// Project adapter over the Row-actions menu: Rename + Delete, owning its own
// delete-confirmation dialog.
export function SidebarProjectMenu({
  project,
  onStartEditing,
  onMenuOpenChange,
  triggerAriaLabel,
}: SidebarProjectMenuProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  return (
    <>
      <RowActionsMenu
        items={[
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
        triggerAriaLabel={triggerAriaLabel ?? "Open project options"}
        onOpenChange={onMenuOpenChange}
        contentSide="bottom"
        contentAlign="start"
      />

      <DialogDeleteProject
        isOpen={isDeleteDialogOpen}
        setIsOpen={setIsDeleteDialogOpen}
        project={project}
      />
    </>
  )
}
