"use client"

import { useChats } from "@/lib/chat-store/chats/provider"
import { useSidebarChatStatus } from "@/lib/chat-store/status/sidebar-chat-status"
import { Chat } from "@/lib/chat-store/types"
import { SidebarItemMenu } from "./sidebar-item-menu"
import { SidebarChatStatusIndicator } from "./sidebar-item-status"
import { SidebarRow } from "./sidebar-row"
import { SidebarChatPinButton } from "./trailing-icon-button"

type SidebarItemProps = {
  chat: Chat
  currentChatId: string
}

// Chat adapter over the Sidebar row module: supplies the chat href/active
// predicate, the title-rename mutation, and the status + pin + actions trailing.
export function SidebarItem({ chat, currentChatId }: SidebarItemProps) {
  const { updateTitle } = useChats()
  const status = useSidebarChatStatus(chat)
  const displayTitle = chat.title || "Untitled Chat"

  return (
    <SidebarRow
      href={`/c/${chat.id}`}
      isActive={chat.id === currentChatId}
      title={displayTitle}
      renameValue={chat.title || ""}
      onRename={(next) => updateTitle(chat.id, next)}
      trailing={({ startRename }) => (
        // Trailing slot (ChatGPT's dynamic right-hand slot). At rest it shows the
        // status indicator; on hover/focus/menu-open the indicator hides and the
        // actions reveal in its place (reveal-by-reflow, globals.css).
        <div
          className="sidebar-row-trailing flex h-full shrink-0 items-center"
          key={chat.id}
        >
          <SidebarChatStatusIndicator
            status={status}
            className="sidebar-row-status"
          />
          <div className="sidebar-row-action flex h-full items-center">
            <SidebarChatPinButton chat={chat} title={displayTitle} />
            <SidebarItemMenu
              chat={chat}
              onStartEditing={startRename}
              triggerAriaLabel={`Open chat actions for ${displayTitle}`}
            />
          </div>
        </div>
      )}
    />
  )
}
