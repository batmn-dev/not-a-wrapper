import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { Icon } from "@/components/ui/icon"
import { useSidebar } from "@/components/ui/sidebar"
import { useInlineRename } from "@/hooks/use-inline-rename"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useSidebarChatStatus } from "@/lib/chat-store/status/sidebar-chat-status"
import { Chat } from "@/lib/chat-store/types"
import { cn } from "@/lib/utils"
import { RiCheckLine, RiCloseLine } from "@remixicon/react"
import Link from "next/link"
import { useCallback, useMemo } from "react"
import { SidebarItemMenu } from "./sidebar-item-menu"
import { SidebarChatStatusIndicator } from "./sidebar-item-status"

type SidebarItemProps = {
  chat: Chat
  currentChatId: string
}

export function SidebarItem({ chat, currentChatId }: SidebarItemProps) {
  const { updateTitle } = useChats()
  const { setOpenMobile } = useSidebar()
  const isMobile = useBreakpoint(768)
  const status = useSidebarChatStatus(chat.id)

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
  const isCurrentChat = useMemo(
    () => chat.id === currentChatId,
    [chat.id, currentChatId]
  )

  const isActive = useMemo(
    () => isCurrentChat || isEditing,
    [isCurrentChat, isEditing]
  )

  const displayTitle = useMemo(
    () => chat.title || "Untitled Chat",
    [chat.title]
  )

  const containerClassName = useMemo(
    () =>
      cn(
        "sidebar-row menu-item-hoverable hover:bg-accent/80 hover:text-foreground group/chat relative mx-1.5 flex h-9 w-[calc(100%-var(--spacing)*3)] items-center rounded-lg pointer-coarse:h-auto",
        isActive &&
          "bg-accent hover:bg-accent text-foreground group-data-[collapsible=icon]:bg-transparent"
      ),
    [isActive]
  )

  return (
    <div
      className={containerClassName}
      onClick={onContainerClick}
      ref={containerRef}
    >
      {isEditing ? (
        <div className="flex h-full w-full items-center rounded-lg py-[3px] pr-1 pl-2">
          <input
            ref={inputRef}
            {...inputProps}
            className="text-primary max-h-full w-full bg-transparent text-base focus:outline-none"
          />
          <div className="flex gap-0.5">
            <button
              onClick={onSaveClick}
              className="hover:bg-secondary text-muted-foreground hover:text-primary flex size-7 items-center justify-center rounded-lg p-1"
              type="button"
            >
              <Icon icon={RiCheckLine} slotSize={16} />
            </button>
            <button
              onClick={onCancelClick}
              className="hover:bg-secondary text-muted-foreground hover:text-primary flex size-7 items-center justify-center rounded-lg p-1"
              type="button"
            >
              <Icon icon={RiCloseLine} slotSize={16} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <Link
            href={`/c/${chat.id}`}
            className="text-primary focus-visible:ring-ring flex h-full min-w-0 grow items-center rounded-lg px-2.5 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset pointer-coarse:h-auto pointer-coarse:py-3"
            prefetch
            draggable={false}
            onClick={handleLinkClick}
            aria-current={isCurrentChat ? "page" : undefined}
            title={displayTitle}
          >
            <span className="min-w-0 truncate" dir="auto">
              {displayTitle}
            </span>
          </Link>

          {/* Trailing slot (ChatGPT's dynamic right-hand slot). At rest it
              shows the status indicator (spinner/dot); on hover/focus/menu-open
              the indicator hides and the actions reveal in its place. Idle rows
              show neither, so the title reclaims the full width. */}
          <div
            className="sidebar-row-trailing flex h-full shrink-0 items-center pr-1"
            key={chat.id}
          >
            <SidebarChatStatusIndicator
              status={status}
              className="sidebar-row-status"
            />
            <div className="sidebar-row-action flex h-full items-center justify-center">
              <SidebarItemMenu
                chat={chat}
                onStartEditing={start}
                triggerAriaLabel={`Open chat actions for ${displayTitle}`}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
