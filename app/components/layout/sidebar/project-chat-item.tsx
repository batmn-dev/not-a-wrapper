"use client"

import { InlineRenameInput } from "@/components/ui/inline-rename-input"
import { useSidebar } from "@/components/ui/sidebar"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { useInlineRename } from "@/hooks/use-inline-rename"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useSidebarChatStatus } from "@/lib/chat-store/status/sidebar-chat-status"
import { Chat } from "@/lib/chat-store/types"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useCallback, useMemo } from "react"
import { SidebarItemMenu } from "./sidebar-item-menu"
import { SidebarChatStatusIndicator } from "./sidebar-item-status"
import { SidebarRowEndSlot } from "./sidebar-row-actions"
import { SidebarChatPinButton } from "./trailing-icon-button"

type ProjectChatItemProps = {
  chat: Chat
  formatDate: (dateString: string) => string
}

export function ProjectChatItem({ chat, formatDate }: ProjectChatItemProps) {
  const { updateTitle } = useChats()
  const { setOpenMobile } = useSidebar()
  const isMobile = useBreakpoint(768)
  const status = useSidebarChatStatus(chat)

  const { isEditing, start, containerRef, inputProps, onContainerClick } =
    useInlineRename(chat.title || "", (next) => updateTitle(chat.id, next))

  const handleLinkClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isMobile) setOpenMobile(false)
    },
    [isMobile, setOpenMobile]
  )

  // Memoize computed values
  const displayTitle = useMemo(
    () => chat.title || "Untitled Chat",
    [chat.title]
  )

  const containerClassName = useMemo(
    () =>
      cn(
        "sidebar-row sidebar-row-card border-border-subtle hover:bg-interactive-hover group/chat relative flex items-start rounded-lg border",
        isEditing ? "bg-interactive-selected" : ""
      ),
    [isEditing]
  )

  if (isEditing) {
    return (
      <div
        className={containerClassName}
        onClick={onContainerClick}
        ref={containerRef}
      >
        <div className="flex w-full items-center p-3 text-base font-medium">
          <InlineRenameInput
            {...inputProps}
            aria-label="Chat title"
            className="w-full"
          />
        </div>
      </div>
    )
  }

  return (
    <div className={containerClassName}>
      <Link
        href={`/c/${chat.id}`}
        className="min-w-0 grow focus-visible:outline-none"
        onClick={handleLinkClick}
        prefetch
        draggable={false}
      >
        <div className="p-3">
          <h3 className="truncate text-base font-medium text-balance">
            {displayTitle}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {chat.updated_at
              ? formatDate(chat.updated_at)
              : chat.created_at
                ? formatDate(chat.created_at)
                : null}
          </p>
        </div>
      </Link>

      <SidebarRowEndSlot
        key={chat.id}
        layout="card"
        status={
          status === "idle" ? undefined : (
            <SidebarChatStatusIndicator status={status} />
          )
        }
      >
        <SidebarChatPinButton chat={chat} title={displayTitle} />
        <SidebarItemMenu
          chat={chat}
          onStartEditing={start}
          triggerAriaLabel={`Open chat actions for ${displayTitle}`}
        />
      </SidebarRowEndSlot>
    </div>
  )
}
