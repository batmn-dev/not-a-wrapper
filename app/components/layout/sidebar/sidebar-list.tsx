import { CollapsibleSection } from "@/components/ui/collapsible-section"
import { Chat } from "@/lib/chat-store/types"
import { SidebarItem } from "./sidebar-item"

type SidebarListProps = {
  title: string
  items: Chat[]
  currentChatId: string
  /** Initial expanded state (default: true) */
  defaultOpen?: boolean
  /** localStorage key for persistence */
  storageKey?: string
}

export function SidebarList({
  title,
  items,
  currentChatId,
  defaultOpen = true,
  storageKey,
}: SidebarListProps) {
  return (
    <CollapsibleSection
      title={title}
      defaultOpen={defaultOpen}
      storageKey={storageKey}
      variant="sidebar"
    >
      {items.map((chat) => (
        <SidebarItem key={chat.id} chat={chat} currentChatId={currentChatId} />
      ))}
    </CollapsibleSection>
  )
}
