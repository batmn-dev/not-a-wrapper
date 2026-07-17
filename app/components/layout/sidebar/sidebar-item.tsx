"use client"

import { Icon } from "@/components/ui/icon"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useSidebarChatStatus } from "@/lib/chat-store/status/sidebar-chat-status"
import { Chat } from "@/lib/chat-store/types"
import { RiChat3Line } from "@remixicon/react"
import { SidebarItemMenu } from "./sidebar-item-menu"
import { SidebarChatStatusIndicator } from "./sidebar-item-status"
import { SidebarRow } from "./sidebar-row"
import { SidebarRowEndSlot } from "./sidebar-row-actions"
import { SidebarChatPinButton } from "./trailing-icon-button"

type SidebarItemProps = {
  chat: Chat
  currentChatId: string
  presentation?:
    | { kind: "history" }
    | { kind: "nested"; projectName: string }
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
    presentation.kind === "nested" ||
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
      indentation={presentation.kind === "nested" ? "nested" : "standard"}
      renameValue={chat.title || ""}
      renameLabel="Chat title"
      onRename={(next) => updateTitle(chat.id, next)}
      leading={
        presentation.kind === "pinned" ? (
          <Icon icon={RiChat3Line} slotSize={20} />
        ) : undefined
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
