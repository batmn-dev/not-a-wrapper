import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import type { Metadata } from "next"
import { SidebarRowStates, SidebarRowStatuses } from "./demos"

const statesCode = `"use client"

import { SidebarRow } from "@/app/components/layout/sidebar/sidebar-row"
import { SidebarRowEndSlot } from "@/app/components/layout/sidebar/sidebar-row-actions"
import { SidebarPinAction } from "@/app/components/layout/sidebar/trailing-icon-button"

export function ChatRow({ chat }: { chat: Chat }) {
  return (
    <SidebarRow
      interaction={{ kind: "link", href: \`/c/\${chat.id}\` }}
      isActive={chat.id === currentChatId}
      title={chat.title}
      secondaryLabel={projectName}
      renameValue={chat.title}
      renameLabel="Chat title"
      onRename={(next) => updateTitle(chat.id, next)}
      trailing={({ startRename }) => (
        <SidebarRowEndSlot>
          <SidebarPinAction
            pinned={pinned}
            title={chat.title}
            itemType="Chat"
            onTogglePinned={togglePinned}
          />
          {/* production rows continue with SidebarItemMenu(startRename) */}
        </SidebarRowEndSlot>
      )}
    />
  )
}`

const statusesCode = `import { SidebarChatStatusIndicator } from "@/app/components/layout/sidebar/sidebar-item-status"
import { SidebarRowEndSlot } from "@/app/components/layout/sidebar/sidebar-row-actions"

// At rest the end slot shows the status; on hover/focus/menu-open the
// indicator hides and the actions reveal in its place (reveal-by-reflow).
<SidebarRowEndSlot
  status={status === "idle" ? undefined : (
    <SidebarChatStatusIndicator status={status} />
  )}
>
  {actions}
</SidebarRowEndSlot>`

const apiRows = [
  {
    prop: "interaction",
    type: '{ kind: "link"; href: string }',
    defaultValue: "—",
    description: "Full-row primary link the row navigates through.",
  },
  {
    prop: "isActive",
    type: "boolean",
    defaultValue: "—",
    description:
      "Drives the active tint and aria-current. Editing forces the tint on.",
  },
  {
    prop: "title",
    type: "string",
    defaultValue: "—",
    description: "Truncating label; also the rename seed.",
  },
  {
    prop: "secondaryLabel",
    type: "string",
    defaultValue: "—",
    description:
      "Optional inline provenance (e.g. project name) after the title.",
  },
  {
    prop: "renameValue / renameLabel",
    type: "string",
    defaultValue: "—",
    description:
      "Current persisted label the inline rename edits from, and the editor's accessible name.",
  },
  {
    prop: "onRename",
    type: "(next: string) => void | Promise<void>",
    defaultValue: "—",
    description:
      "Persistence and error handling live with the caller; the row only owns the edit UX.",
  },
  {
    prop: "leadingIcon / activeLeadingIcon",
    type: 'IconProps["icon"]',
    defaultValue: "—",
    description:
      "Optional leading glyph (and active swap) through the shared geometry slot.",
  },
  {
    prop: "trailing",
    type: "({ startRename }) => ReactNode",
    defaultValue: "—",
    description:
      "Render prop for the trailing cluster; receives startRename so a menu can launch inline rename while the row owns the edit state.",
  },
] as const

export const metadata: Metadata = {
  title: "Sidebar Row | Design System",
  description:
    "The editable, navigable list row used by the app sidebar's chat and project lists.",
}

export default function SidebarRowPage() {
  const sidebarRowSource = readComponentSource(
    "app/components/layout/sidebar/sidebar-row.tsx"
  )

  return (
    <DsPage>
      <DsPageHeader
        slug="sidebar-row"
        title="Sidebar Row"
        description="The editable, navigable row behind the sidebar's chat and project lists: full-row link, inline rename, and a shared trailing lane."
      />

      <DsSection
        id="states"
        title="States and rename"
        description="Hover a row to reveal the pin and rename actions; the rename pencil swaps the row for an inline editor that commits on Enter or click-outside."
      >
        <ComponentPreview code={statesCode} sourceCode={sidebarRowSource}>
          <SidebarRowStates />
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="statuses"
        title="Status slot"
        description="At rest the trailing lane shows the run status; hover, focus, or an open menu replaces it with actions that rejoin the flex layout, so long titles may truncate earlier while the actions are revealed."
      >
        <ComponentPreview code={statusesCode} sourceCode={sidebarRowSource}>
          <SidebarRowStatuses />
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[24, 28, 8, 40]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Production adapters: SidebarItem (chats) and SidebarProjectItem
          (projects) in app/components/layout/sidebar/ supply hrefs, mutations,
          and the actions menu.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
