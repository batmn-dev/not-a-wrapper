"use client"

import { useChats } from "@/lib/chat-store/chats/provider"
import type { Chat } from "@/lib/chat-store/types"
import { SidebarPinAction } from "./trailing-icon-button"

/** Chat-store adapter for the shared sidebar pin-action contract. */
export function SidebarChatPinButton({
  chat,
  title,
}: {
  chat: Chat
  title: string
}) {
  const { togglePinned } = useChats()

  return (
    <SidebarPinAction
      pinned={chat.pinned}
      title={title}
      itemType="Chat"
      onTogglePinned={() => togglePinned(chat.id, !chat.pinned)}
    />
  )
}
