"use client"

import { FeedbackForm } from "@/components/common/feedback-form"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Drawer, DrawerContent } from "@/components/ui/drawer"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { MenuLeadingIcon } from "@/components/ui/menu-leading-icon"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { useUser } from "@/lib/user-store/provider"
import { RiQuestionLine } from "@remixicon/react"

/**
 * Menu item that opens the feedback dialog.
 * Rendered inside DropdownMenuContent.
 */
export function FeedbackMenuItem({ onClick }: { onClick: () => void }) {
  return (
    <DropdownMenuItem onClick={onClick}>
      <MenuLeadingIcon icon={RiQuestionLine} />
      <span>Feedback</span>
    </DropdownMenuItem>
  )
}

/**
 * Feedback dialog/drawer — must be rendered OUTSIDE DropdownMenu
 * so it doesn't unmount when the menu closes.
 */
export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useUser()
  const isMobile = useBreakpoint(768)

  const handleClose = () => {
    onOpenChange(false)
  }

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="bg-background border-border">
          <FeedbackForm authUserId={user?.id} onClose={handleClose} />
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-md">
        <FeedbackForm authUserId={user?.id} onClose={handleClose} />
      </DialogContent>
    </Dialog>
  )
}
