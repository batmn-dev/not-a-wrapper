import { CollapsibleSection } from "@/components/ui/collapsible-section"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Chat } from "@/lib/chat-store/types"
import {
  RiAddLine,
  RiDragMove2Line,
  RiFolderLine,
  RiListUnordered,
  RiMoreFill,
  RiStarLine,
  RiTimeLine,
} from "@remixicon/react"
import Link from "next/link"
import type { ReactNode } from "react"
import { SidebarItem } from "./sidebar-item"

type SidebarListProps = {
  title: string
  items: Chat[]
  currentChatId: string
  /** Initial expanded state (default: true) */
  defaultOpen?: boolean
  /** localStorage key for persistence */
  storageKey?: string
  /** Shows the organizer placeholders and new-chat action in the header */
  showHeaderActions?: boolean
  /** Closes the mobile drawer after starting a new chat */
  onNewChat?: () => void
}

export function SidebarList({
  title,
  items,
  currentChatId,
  defaultOpen = true,
  storageKey,
  showHeaderActions = false,
  onNewChat,
}: SidebarListProps) {
  const headerActions = showHeaderActions ? (
    <SidebarChatGroupActions onNewChat={onNewChat} />
  ) : null

  return (
    <CollapsibleSection
      title={title}
      defaultOpen={defaultOpen}
      storageKey={storageKey}
      variant="sidebar"
      headerActions={headerActions}
    >
      {items.map((chat) => (
        <SidebarItem key={chat.id} chat={chat} currentChatId={currentChatId} />
      ))}
    </CollapsibleSection>
  )
}

const headerActionClassName =
  "sidebar-group-header-action text-[var(--text-tertiary)] hover:text-foreground active:text-foreground focus-visible:text-foreground data-popup-open:text-foreground flex h-9 w-[34px] shrink-0 items-center -my-2 -ms-1 -me-2.5 rounded-e-[10px] ps-1 pe-1.5 opacity-0 transition-opacity duration-150 group-hover/sidebar-expando-section-header:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 outline-none pointer-coarse:opacity-100"

const sidebarMenuRadioItemClassName =
  "mx-1.5 rounded-[10px] px-2.5 pr-8 [--icon-slot-size:20px] [&_[data-slot=dropdown-menu-radio-item-indicator]]:inset-y-0"

function SidebarHeaderActionChip({ children }: { children: ReactNode }) {
  return (
    <span className="sidebar-group-header-action-chip flex size-6 items-center justify-center rounded-[8px]">
      {children}
    </span>
  )
}

function SidebarChatGroupActions({ onNewChat }: { onNewChat?: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1 pe-2.5 text-[var(--text-tertiary)]">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={headerActionClassName}
              aria-label="Organize chats"
            />
          }
        >
          <SidebarHeaderActionChip>
            <Icon icon={RiMoreFill} slotSize={16} glyphInset={0} />
          </SidebarHeaderActionChip>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          sideOffset={-4}
          align="start"
          alignOffset={-8}
          animated={false}
          className="sidebar-group-header w-[190px] min-w-[190px] rounded-[16px] px-0"
          style={{
            boxShadow:
              "0 8px 12px 0 rgb(0 0 0 / 0.08), 0 0 1px 0 rgb(0 0 0 / 0.62)",
          }}
        >
          <div className="__menu-label mx-1.5 h-9 px-2.5 py-2 text-sm leading-5 font-normal text-[var(--text-tertiary)]">
            Organize
          </div>
          <DropdownMenuRadioGroup value="by-project">
            <DropdownMenuRadioItem
              value="by-project"
              className={sidebarMenuRadioItemClassName}
            >
              <Icon icon={RiFolderLine} />
              By project
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="one-list"
              className={sidebarMenuRadioItemClassName}
            >
              <Icon icon={RiListUnordered} />
              In one list
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator className="mx-3 my-1.5" />
          <div className="__menu-label mx-1.5 h-9 px-2.5 py-2 text-sm leading-5 font-normal text-[var(--text-tertiary)]">
            Sort by
          </div>
          <DropdownMenuRadioGroup value="priority">
            <DropdownMenuRadioItem
              value="priority"
              className={sidebarMenuRadioItemClassName}
            >
              <Icon icon={RiStarLine} />
              Priority
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="last-updated"
              className={sidebarMenuRadioItemClassName}
            >
              <Icon icon={RiTimeLine} />
              Last updated
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="manual-order"
              className={sidebarMenuRadioItemClassName}
            >
              <Icon icon={RiDragMove2Line} />
              Manual order
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip disableHoverablePopup>
        <TooltipTrigger
          render={
            <Link
              href="/"
              onClick={onNewChat}
              className={headerActionClassName}
              aria-label="New Chat"
            />
          }
        >
          <SidebarHeaderActionChip>
            <Icon icon={RiAddLine} slotSize={16} glyphInset={0} />
          </SidebarHeaderActionChip>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={-6}
          variant="outline"
          className="text-sm font-normal"
        >
          New Chat
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
