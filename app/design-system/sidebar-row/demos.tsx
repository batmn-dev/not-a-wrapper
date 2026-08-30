"use client"

import { SidebarChatStatusIndicator } from "@/app/components/layout/sidebar/sidebar-item-status"
import { SidebarRow } from "@/app/components/layout/sidebar/sidebar-row"
import { SidebarRowEndSlot } from "@/app/components/layout/sidebar/sidebar-row-actions"
import {
  SidebarPinAction,
  trailingIconButtonClassName,
  TrailingIconChip,
} from "@/app/components/layout/sidebar/trailing-icon-button"
import { SidebarDemoColumn } from "@/app/design-system/_components/sidebar-demo-column"
import { Icon } from "@/components/ui/icon"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { SidebarChatStatus } from "@/lib/chat-store/status/sidebar-chat-status"
import { RiEditLine } from "@remixicon/react"
import { useState } from "react"

/**
 * Client-side demos with a stub persistence adapter: rename commits to local
 * state instead of a chat-store mutation, everything else is the production
 * row. The trailing cluster uses the real SidebarPinAction plus a rename
 * button in the ChatActionsMenu position (the real menu needs the chat store).
 */

function RenameAction({ onStartRename }: { onStartRename: () => void }) {
  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={trailingIconButtonClassName}
            aria-label="Rename"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onStartRename()
            }}
          />
        }
      >
        <TrailingIconChip>
          <Icon icon={RiEditLine} slotSize={18} />
        </TrailingIconChip>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={-6} variant="outline">
        Rename
      </TooltipContent>
    </Tooltip>
  )
}

function DemoChatRow({
  initialTitle,
  isActive = false,
  secondaryLabel,
  status = "idle",
}: {
  initialTitle: string
  isActive?: boolean
  secondaryLabel?: string
  status?: SidebarChatStatus
}) {
  const [title, setTitle] = useState(initialTitle)
  const [pinned, setPinned] = useState(false)

  return (
    <SidebarRow
      interaction={{ kind: "link", href: "#" }}
      isActive={isActive}
      title={title}
      secondaryLabel={secondaryLabel}
      renameValue={title}
      renameLabel="Chat title"
      onRename={(next) => setTitle(next)}
      trailing={({ startRename }) => (
        <SidebarRowEndSlot
          status={
            status === "idle" ? undefined : (
              <SidebarChatStatusIndicator status={status} />
            )
          }
        >
          <SidebarPinAction
            pinned={pinned}
            title={title}
            itemType="Chat"
            onTogglePinned={() => setPinned((p) => !p)}
          />
          <RenameAction onStartRename={startRename} />
        </SidebarRowEndSlot>
      )}
    />
  )
}

export function SidebarRowStates() {
  return (
    <SidebarDemoColumn>
      <DemoChatRow initialTitle="Active conversation" isActive />
      <DemoChatRow initialTitle="Hover me: pin and rename reveal" />
      <DemoChatRow
        initialTitle="Quarterly report draft"
        secondaryLabel="Work notes"
      />
      <DemoChatRow initialTitle="A very long title that truncates before the trailing lane" />
    </SidebarDemoColumn>
  )
}

export function SidebarRowStatuses() {
  return (
    <SidebarDemoColumn>
      <DemoChatRow initialTitle="Generating response" status="streaming" />
      <DemoChatRow initialTitle="Waiting for you" status="awaiting" />
      <DemoChatRow initialTitle="New activity" status="unread" />
      <DemoChatRow initialTitle="Generation failed" status="error" />
    </SidebarDemoColumn>
  )
}
