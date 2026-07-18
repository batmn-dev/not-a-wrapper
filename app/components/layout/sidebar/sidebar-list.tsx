import { CollapsibleSection } from "@/components/ui/collapsible-section"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  RiFolderLine,
  RiListUnordered,
  RiMoreFill,
} from "@remixicon/react"
import Link from "next/link"
import { useState, type ReactNode } from "react"
import type { ChatOrganization } from "./chat-organization"
import { SidebarItem } from "./sidebar-item"

type SidebarListProps = {
  title: string
  items: Chat[]
  /** Rows inserted before chats, used for the mixed global Pinned section. */
  beforeItems?: ReactNode
  presentation?:
    | { kind: "history"; projectNames?: ReadonlyMap<string, string> }
    | { kind: "pinned"; projectNames: ReadonlyMap<string, string> }
  currentChatId: string
  /** Initial expanded state (default: true) */
  defaultOpen?: boolean
  /** localStorage key for persistence */
  storageKey?: string
  /** Shows the organizer and new-chat action in the header. */
  showHeaderActions?: boolean
  organization?: ChatOrganization
  onOrganizationChange?: (organization: ChatOrganization) => void
  /** Closes the mobile drawer after starting a new chat */
  onNewChat?: () => void
}

export function SidebarList({
  title,
  items,
  beforeItems,
  presentation = { kind: "history" },
  currentChatId,
  defaultOpen = true,
  storageKey,
  showHeaderActions = false,
  organization,
  onOrganizationChange,
  onNewChat,
}: SidebarListProps) {
  const headerActions = showHeaderActions ? (
    <SidebarChatGroupActions
      organization={organization ?? "by-project"}
      onOrganizationChange={onOrganizationChange}
      onNewChat={onNewChat}
    />
  ) : null

  return (
    <CollapsibleSection
      title={title}
      defaultOpen={defaultOpen}
      storageKey={storageKey}
      variant="sidebar"
      headerActions={headerActions}
    >
      {beforeItems}
      {items.map((chat) => (
        <SidebarItem
          key={chat.id}
          chat={chat}
          currentChatId={currentChatId}
          presentation={getChatRowPresentation(chat, presentation)}
        />
      ))}
    </CollapsibleSection>
  )
}

function getChatRowPresentation(
  chat: Chat,
  presentation: NonNullable<SidebarListProps["presentation"]>
) {
  const projectName = chat.project_id
    ? presentation.projectNames?.get(chat.project_id)
    : undefined
  if (presentation.kind === "pinned") {
    return { kind: "pinned" as const, projectName }
  }
  return projectName
    ? { kind: "recent-project" as const, projectName }
    : { kind: "history" as const }
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

export function SidebarChatGroupActions({
  organization,
  onOrganizationChange,
  onNewChat,
  onNewProject,
}: {
  organization: ChatOrganization
  onOrganizationChange?: (organization: ChatOrganization) => void
  onNewChat?: () => void
  onNewProject?: () => void
}) {
  const isProjectAction = onNewProject != null
  const [isOrganizerOpen, setIsOrganizerOpen] = useState(false)

  return (
    <div className="flex shrink-0 items-center gap-1 pe-2.5 text-[var(--text-tertiary)]">
      <DropdownMenu open={isOrganizerOpen} onOpenChange={setIsOrganizerOpen}>
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
            Organize chats
          </div>
          <DropdownMenuRadioGroup
            value={organization}
            onValueChange={(value) => {
              onOrganizationChange?.(value as ChatOrganization)
              setIsOrganizerOpen(false)
            }}
          >
            <DropdownMenuRadioItem
              value="one-list"
              className={sidebarMenuRadioItemClassName}
            >
              <Icon icon={RiListUnordered} />
              In one list
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="by-project"
              className={sidebarMenuRadioItemClassName}
            >
              <Icon icon={RiFolderLine} />
              By project
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip disableHoverablePopup>
        <TooltipTrigger
          render={
            isProjectAction ? (
              <button
                type="button"
                onClick={onNewProject}
                className={headerActionClassName}
                aria-label="New project"
              />
            ) : (
              <Link
                href="/"
                onClick={onNewChat}
                className={headerActionClassName}
                aria-label="New chat"
              />
            )
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
          {isProjectAction ? "New project" : "New chat"}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
