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
import { SidebarChatPinButton } from "./trailing-icon-button"

type SidebarItemProps = {
  chat: Chat
  currentChatId: string
}

export function SidebarItem({ chat, currentChatId }: SidebarItemProps) {
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
        // hover == selected == menu-open, all driven off the one translucent
        // --sidebar-row-active-background token (ChatGPT uses the same value for
        // every state — no stronger active tint, no /80 hover).
        "sidebar-row menu-item-hoverable hover:bg-[var(--sidebar-row-active-background)] hover:text-foreground group/chat relative mx-1.5 flex h-9 w-[calc(100%-var(--spacing)*3)] items-center rounded-lg pointer-coarse:h-auto",
        isActive &&
          "bg-[var(--sidebar-row-active-background)] hover:bg-[var(--sidebar-row-active-background)] text-foreground group-data-[collapsible=icon]:bg-transparent"
      ),
    [isActive]
  )

  // Rename mode keeps the plain <div> container (it needs containerRef for
  // click-outside-commits and swaps the whole row for an input).
  if (isEditing) {
    return (
      <div
        className={containerClassName}
        onClick={onContainerClick}
        ref={containerRef}
      >
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
      </div>
    )
  }

  // Resting/nav mode: the <Link> IS the whole row (ChatGPT's single `<a>`), with
  // the title and the trailing actions nested INSIDE it. This is the structural
  // fix for the dead corners: `border-radius` clips pointer hit-testing, so the
  // menu button's rounded-corner cutouts fall through to whatever paints behind
  // them — now the navigable Link (ChatGPT) instead of a non-navigable <div>
  // (our old wrapper). The nested button stops propagation, so activating it
  // opens the menu without navigating. Whole row is one contiguous hit target.
  return (
    <Link
      href={`/c/${chat.id}`}
      className={cn(
        containerClassName,
        // ChatGPT's `.__menu-item` <a> box: symmetric 10px inline / 6px block
        // padding, so the title truncates 10px from the row edge. The trailing
        // button overflows this right padding back to the edge via a hover-only
        // negative end-margin (see `.sidebar-row-action` in globals.css) — the
        // title keeps its inset instead of the button eating into it.
        // No focus ring on the row itself (ChatGPT's chat <a> has none): keyboard
        // focus surfaces via the :focus-within active tint + the reveal, and the
        // trailing buttons carry their own inner-chip ring.
        "text-primary px-2.5 py-1.5 text-sm focus-visible:outline-none pointer-coarse:py-3"
      )}
      prefetch
      draggable={false}
      onClick={handleLinkClick}
      aria-current={isCurrentChat ? "page" : undefined}
      title={displayTitle}
    >
      <span className="min-w-0 grow truncate" dir="auto">
        {displayTitle}
      </span>

      {/* Trailing slot (ChatGPT's dynamic right-hand slot). At rest it shows the
          status indicator (spinner/dot); on hover/focus/menu-open the indicator
          hides and the actions reveal in its place. Idle rows show neither, so
          the title reclaims the full width. */}
      <div
        className="sidebar-row-trailing flex h-full shrink-0 items-center"
        key={chat.id}
      >
        <SidebarChatStatusIndicator
          status={status}
          className="sidebar-row-status"
        />
        {/* Pin + options pair (ChatGPT's 44px trailing slot). The 24px chips are
            pulled adjacent by the `.sidebar-row-action > button ~ button` rule in
            globals.css (options overlaps the pin by 10px), which is robust against
            the focus-guard spans base-ui injects around the menu trigger; the
            options chip still lands flush to the row edge via the end-margin. */}
        <div className="sidebar-row-action flex h-full items-center">
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
