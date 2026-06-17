import { ChatActionsMenu } from "@/app/components/layout/chat-actions-menu"
import type { Chat } from "@/lib/chat-store/types"

type SidebarItemMenuProps = {
  chat: Chat
  onStartEditing: () => void
  onMenuOpenChange?: (open: boolean) => void
  triggerAriaLabel?: string
}

export function SidebarItemMenu({
  chat,
  onStartEditing,
  onMenuOpenChange,
  triggerAriaLabel,
}: SidebarItemMenuProps) {
  return (
    <ChatActionsMenu
      chat={chat}
      onRename={onStartEditing}
      onOpenChange={onMenuOpenChange}
      triggerAriaLabel={triggerAriaLabel}
      contentSide="bottom"
      contentAlign="start"
    />
  )
}
