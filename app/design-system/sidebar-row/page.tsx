import { ComponentPager } from "@/app/design-system/_components/component-pager"
import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Metadata } from "next"
import { SidebarRowStates, SidebarRowStatuses } from "./demos"

const statesCode = `import { SidebarRow } from "@/app/components/layout/sidebar/sidebar-row"
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
  return (
    <main id="main" className="w-full max-w-[680px] px-6 pt-10 pb-24 md:pt-28">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-[28px] leading-8 font-semibold tracking-tight">
            Sidebar Row
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-5">
            The single editable/navigable compact row behind the sidebar&apos;s
            chat and project lists: full-row link, inline rename with
            click-outside-commit, and a trailing lane where resting status and
            hover-revealed actions share one geometry. Demos stub persistence
            with local state; everything else is the production component.
          </p>
        </div>
        <ComponentPager slug="sidebar-row" />
      </header>

      <section aria-labelledby="states-heading" className="mt-10">
        <h2 id="states-heading" className="text-base font-semibold">
          States and rename
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-5">
          Hover a row to reveal the pin and rename actions; the rename pencil
          swaps the row for an inline editor that commits on Enter or
          click-outside.
        </p>
        <div className="mt-3">
          <ComponentPreview code={statesCode}>
            <SidebarRowStates />
          </ComponentPreview>
        </div>
      </section>

      <section aria-labelledby="statuses-heading" className="mt-16">
        <h2 id="statuses-heading" className="text-base font-semibold">
          Status slot
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-5">
          At rest the trailing lane shows the run status; hover, focus, or an
          open menu replaces it with actions that rejoin the flex layout, so
          long titles may truncate earlier while the actions are revealed.
        </p>
        <div className="mt-3">
          <ComponentPreview code={statusesCode}>
            <SidebarRowStatuses />
          </ComponentPreview>
        </div>
      </section>

      <section aria-labelledby="api-heading" className="mt-16">
        <h2 id="api-heading" className="text-base font-semibold">
          API Reference
        </h2>
        <div className="mt-3 overflow-hidden rounded-xl border">
          <Table className="min-w-[38rem] table-fixed">
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[28%]" />
              <col className="w-[8%]" />
              <col className="w-[40%]" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-3">Prop</TableHead>
                <TableHead className="px-3">Type</TableHead>
                <TableHead className="px-3">Default</TableHead>
                <TableHead className="px-3">Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiRows.map((row) => (
                <TableRow key={row.prop} className="hover:bg-transparent">
                  <TableCell className="px-3 font-mono text-xs font-medium whitespace-normal">
                    {row.prop}
                  </TableCell>
                  <TableCell className="px-3 font-mono text-xs whitespace-normal">
                    {row.type}
                  </TableCell>
                  <TableCell className="px-3 font-mono text-xs whitespace-normal">
                    {row.defaultValue}
                  </TableCell>
                  <TableCell className="px-3 whitespace-normal">
                    {row.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground mt-3 text-sm leading-5">
          Production adapters: SidebarItem (chats) and SidebarProjectItem
          (projects) in app/components/layout/sidebar/ supply hrefs, mutations,
          and the actions menu.
        </p>
      </section>
    </main>
  )
}
