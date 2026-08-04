"use client"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { RiSettings3Line } from "@remixicon/react"
import { useRef } from "react"
import { SidebarLeadingIcon } from "../sidebar/sidebar-leading-icon"
import { SettingsContent } from "./settings-content"

/**
 * Menu item that opens the settings dialog.
 * Rendered inside DropdownMenuContent.
 */
export function SettingsMenuItem({ onClick }: { onClick: () => void }) {
  return (
    <DropdownMenuItem onClick={onClick} className="gap-0">
      <SidebarLeadingIcon icon={RiSettings3Line} />
      <span>Settings</span>
    </DropdownMenuItem>
  )
}

/**
 * Settings dialog/drawer — must be rendered OUTSIDE DropdownMenu
 * so it doesn't unmount when the menu closes.
 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const dialogContentRef = useRef<HTMLDivElement>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogContentRef}
        initialFocus={dialogContentRef}
        showCloseButton={false}
        className="flex flex-col gap-0 overflow-hidden rounded-2xl p-0"
        style={{
          height: "calc(100dvh - 2rem)",
          maxHeight: "720px",
          width: "calc(100vw - 2rem)",
          maxWidth: "824px",
        }}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <SettingsContent />
      </DialogContent>
    </Dialog>
  )
}
