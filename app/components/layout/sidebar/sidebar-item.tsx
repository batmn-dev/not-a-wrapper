"use client"

import { useChats } from "@/lib/chat-store/chats/provider"
import { useSidebarChatStatus } from "@/lib/chat-store/status/sidebar-chat-status"
import { Chat } from "@/lib/chat-store/types"
import { RiChat3Line, RiChatSmile2Fill } from "@remixicon/react"
import { SidebarChatPinButton } from "./sidebar-chat-pin-button"
import { SidebarItemMenu } from "./sidebar-item-menu"
import { SidebarChatStatusIndicator } from "./sidebar-item-status"
import { SidebarRow } from "./sidebar-row"
import { SidebarRowEndSlot } from "./sidebar-row-actions"

type SidebarItemProps = {
  chat: Chat
  currentChatId: string
  presentation?:
    | { kind: "history" }
    | { kind: "pinned"; projectName?: string }
    | { kind: "recent-project"; projectName: string }
}

// Chat adapter over the Sidebar row module: supplies the chat href/active
// predicate, the title-rename mutation, and the status + pin + actions trailing.
export function SidebarItem({
  chat,
  currentChatId,
  presentation = { kind: "history" },
}: SidebarItemProps) {
  const { updateTitle } = useChats()
  const status = useSidebarChatStatus(chat)
  const displayTitle = chat.title || "Untitled Chat"
  const isProjectPresentation =
    presentation.kind === "recent-project" ||
    (presentation.kind === "pinned" && presentation.projectName != null)
  const projectName = isProjectPresentation
    ? presentation.projectName
    : undefined
  const ariaLabel =
    presentation.kind === "pinned"
      ? `${displayTitle}, pinned conversation${projectName ? ` in project ${projectName}` : ""}`
      : projectName
        ? `${displayTitle}, chat in project ${projectName}`
        : undefined

  return (
    <SidebarRow
      interaction={{ kind: "link", href: `/c/${chat.id}` }}
      isActive={chat.id === currentChatId}
      title={displayTitle}
      secondaryLabel={
        presentation.kind === "recent-project" || presentation.kind === "pinned"
          ? projectName
          : undefined
      }
      ariaLabel={ariaLabel}
      renameValue={chat.title || ""}
      renameLabel="Chat title"
      onRename={(next) => updateTitle(chat.id, next)}
      leadingIcon={presentation.kind === "pinned" ? RiChat3Line : undefined}
      activeLeadingIcon={
        presentation.kind === "pinned" ? RiChatSmile2Fill : undefined
      }
      trailing={({ startRename }) => (
        // Trailing slot (ChatGPT's dynamic right-hand slot). At rest it shows the
        // status indicator; on hover/focus/menu-open the indicator hides and the
        // actions reveal in its place (reveal-by-reflow, globals.css).
        <SidebarRowEndSlot
          key={chat.id}
          status={
            status === "idle" ? undefined : (
              <SidebarChatStatusIndicator status={status} />
            )
          }
        >
          <SidebarChatPinButton chat={chat} title={displayTitle} />
          <SidebarItemMenu
            chat={chat}
            onStartEditing={startRename}
            triggerAriaLabel={`Open chat actions for ${displayTitle}`}
          />
        </SidebarRowEndSlot>
      )}
    />
  )
}
