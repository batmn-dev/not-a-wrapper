"use client"

import { ChatActionsMenu } from "@/app/components/layout/chat-actions-menu"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useWarmSelectedConversation } from "@/lib/chat-store/messages/warm"
import { useSidebarChatStatus } from "@/lib/chat-store/status/sidebar-chat-status"
import { Chat } from "@/lib/chat-store/types"
import { markChatNavigationIntent } from "@/lib/observability/chat-performance-client"
import { RiChat3Line, RiChatSmile2Fill } from "@remixicon/react"
import { useCallback } from "react"
import { SidebarChatStatusIndicator } from "./sidebar-item-status"
import { SidebarRow } from "./sidebar-row"
import { SidebarRowEndSlot } from "./sidebar-row-actions"
import { SidebarPinAction } from "./trailing-icon-button"

type SidebarItemProps = {
  chat: Chat
  currentChatId?: string
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
  const { togglePinned, updateTitle } = useChats()
  const warmSelectedConversation = useWarmSelectedConversation()
  const warmChat = useCallback(
    () => warmSelectedConversation(chat.id),
    [chat.id, warmSelectedConversation]
  )
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
      // Chat-switch responsiveness anchor: the navigation intent, marked
      // before Next.js routing commits (content-free no-op unless
      // instrumentation is enabled). Chat rows only: a project route commits
      // with no chat and must never arm the thread paint pair.
      onNavigate={markChatNavigationIntent}
      onWarm={warmChat}
      leadingIcon={presentation.kind === "pinned" ? RiChat3Line : undefined}
      activeLeadingIcon={
        presentation.kind === "pinned" ? RiChatSmile2Fill : undefined
      }
      trailing={({ startRename }) => (
        <SidebarRowEndSlot
          key={chat.id}
          status={
            status === "idle" ? undefined : (
              <SidebarChatStatusIndicator status={status} />
            )
          }
        >
          <SidebarPinAction
            pinned={chat.pinned}
            title={displayTitle}
            itemType="Chat"
            onTogglePinned={() => togglePinned(chat.id, !chat.pinned)}
          />
          <ChatActionsMenu
            chat={chat}
            onRename={startRename}
            triggerAriaLabel={`Open chat actions for ${displayTitle}`}
          />
        </SidebarRowEndSlot>
      )}
    />
  )
}
