"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { Icon } from "@/components/ui/icon"
import { useSidebar } from "@/components/ui/sidebar"
import { useInlineRename } from "@/hooks/use-inline-rename"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useSidebarChatStatus } from "@/lib/chat-store/status/sidebar-chat-status"
import { Chat } from "@/lib/chat-store/types"
import { cn } from "@/lib/utils"
import { RiChat3Line, RiCheckLine, RiCloseLine } from "@remixicon/react"
import Link from "next/link"
import { useCallback, useMemo } from "react"
import { SidebarItemMenu } from "./sidebar-item-menu"
import { SidebarChatStatusIndicator } from "./sidebar-item-status"
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

  const {
    isEditing,
    start,
    inputRef,
    containerRef,
    inputProps,
    onContainerClick,
    onSaveClick,
    onCancelClick,
  } = useInlineRename(chat.title || "", (next) => updateTitle(chat.id, next))

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
        "sidebar-row sidebar-row-card border-border hover:bg-accent/50 group/chat relative flex items-start rounded-lg border",
        isEditing ? "bg-accent/50" : ""
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
        <div className="flex w-full items-center p-3">
          <Icon
            icon={RiChat3Line}
            slotSize={16}
            className="text-muted-foreground mr-3 flex-shrink-0"
          />
          <input
            ref={inputRef}
            {...inputProps}
            className="text-primary flex-1 bg-transparent text-base font-medium focus:outline-none"
          />
          <div className="ml-2 flex gap-1">
            <button
              onClick={onSaveClick}
              className="hover:bg-secondary text-muted-foreground hover:text-primary flex size-6 items-center justify-center rounded-lg p-1"
              type="button"
            >
              <Icon icon={RiCheckLine} slotSize={12} />
            </button>
            <button
              onClick={onCancelClick}
              className="hover:bg-secondary text-muted-foreground hover:text-primary flex size-6 items-center justify-center rounded-lg p-1"
              type="button"
            >
              <Icon icon={RiCloseLine} slotSize={12} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Nav mode mirrors the compact row: the <Link> IS the whole card (title, date,
  // AND the trailing slot nested inside), so the menu button's rounded corners
  // fall through to the navigable anchor instead of a non-navigable wrapper —
  // killing the dead corners the old div+sibling-Link structure reintroduced.
  return (
    <Link
      href={`/c/${chat.id}`}
      className={cn(containerClassName, "focus-visible:outline-none")}
      onClick={handleLinkClick}
      prefetch
      draggable={false}
    >
      <div className="min-w-0 grow p-3">
        <h3 className="truncate font-medium text-balance">{displayTitle}</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          {chat.updated_at
            ? formatDate(chat.updated_at)
            : chat.created_at
              ? formatDate(chat.created_at)
              : null}
        </p>
      </div>

      <div
        className="sidebar-row-trailing flex shrink-0 items-center pt-3 pr-3"
        key={chat.id}
      >
        <SidebarChatStatusIndicator
          status={status}
          className="sidebar-row-status"
        />
        <div className="sidebar-row-action flex items-center">
          <SidebarChatPinButton chat={chat} title={displayTitle} />
          <SidebarItemMenu
            chat={chat}
            onStartEditing={start}
            triggerAriaLabel={`Open chat actions for ${displayTitle}`}
          />
        </div>
      </div>
    </Link>
  )
}
