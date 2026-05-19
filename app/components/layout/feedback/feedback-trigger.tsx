"use client"
import { RiQuestionLine } from "@remixicon/react"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { useUser } from "@/lib/user-store/provider"
import { FeedbackForm } from "@/components/common/feedback-form"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Drawer, DrawerContent } from "@/components/ui/drawer"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"

/**
 * Menu item that opens the feedback dialog.
 * Rendered inside DropdownMenuContent.
 */
export function FeedbackMenuItem({ onClick }: { onClick: () => void }) {
  return (
    <DropdownMenuItem onClick={onClick}>
      <RiQuestionLine size={16} />
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
      <DialogContent className="[&>button:last-child]:bg-background overflow-hidden p-0 sm:max-w-md [&>button:last-child]:top-3.5 [&>button:last-child]:right-3 [&>button:last-child]:rounded-full [&>button:last-child]:p-1">
        <FeedbackForm authUserId={user?.id} onClose={handleClose} />
      </DialogContent>
    </Dialog>
  )
}
