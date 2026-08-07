import { ComponentPager } from "@/app/design-system/_components/component-pager"
import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Metadata } from "next"
import { SidebarMenuItemStates, SidebarMenuItemTrailing } from "./demos"

const statesCode = `import { SidebarMenuItem } from "@/app/components/layout/sidebar/sidebar-menu-item"
import { RiAddCircleFill, RiAddCircleLine, RiSearchLine, RiSettings3Line } from "@remixicon/react"

export function SidebarMenuItemStates() {
  return (
    <div className="bg-sidebar w-(--sidebar-width) py-1">
      <SidebarMenuItem
        icon={RiAddCircleLine}
        activeIcon={RiAddCircleFill}
        label="Active (icon swaps to filled)"
        isActive
      />
      <SidebarMenuItem icon={RiSearchLine} label="Default" />
      <SidebarMenuItem
        icon={RiSettings3Line}
        label="Disabled"
        disabled
        aria-disabled="true"
      />
      <SidebarMenuItem label="Text-only (no icon)" />
    </div>
  )
}`

const trailingCode = `import { SidebarMenuItem } from "@/app/components/layout/sidebar/sidebar-menu-item"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { RiSearchLine } from "@remixicon/react"

export function SidebarMenuItemTrailing() {
  return (
    <SidebarMenuItem
      icon={RiSearchLine}
      label="Hover to reveal shortcut"
      trailing={
        <KbdGroup>
          <Kbd label="Command">⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      }
    />
  )
}`

const apiRows = [
  {
    prop: "label",
    type: "string",
    defaultValue: "—",
    description: "Truncating row label.",
  },
  {
    prop: "icon",
    type: "IconProps[\"icon\"]",
    defaultValue: "—",
    description:
      "Optional leading glyph, rendered through the shared SidebarLeadingIcon geometry slot.",
  },
  {
    prop: "activeIcon",
    type: "IconProps[\"icon\"]",
    defaultValue: "—",
    description: "Glyph swapped in while the row is active.",
  },
  {
    prop: "href",
    type: "string",
    defaultValue: "—",
    description:
      "Renders the row as a prefetching Link; omit it to render a button.",
  },
  {
    prop: "onClick",
    type: "MouseEventHandler",
    defaultValue: "—",
    description: "Button action, or navigation side effects on Link rows.",
  },
  {
    prop: "trailing",
    type: "ReactNode",
    defaultValue: "—",
    description:
      "Trailing content (shortcuts, badges) revealed on hover of the row.",
  },
  {
    prop: "trailingInteractive",
    type: "boolean",
    defaultValue: "false",
    description:
      "Set when trailing is a control: keeps it reachable via focus-within and on touch devices.",
  },
  {
    prop: "isActive",
    type: "boolean",
    defaultValue: "false",
    description:
      "Applies the active row tint and activeIcon swap. For Link rows, it also sets aria-current to page.",
  },
] as const

export const metadata: Metadata = {
  title: "Sidebar Menu Item | Design System",
  description:
    "The canonical static sidebar navigation row used by the app sidebar.",
}

export default function SidebarMenuItemPage() {
  const sidebarMenuItemSource = readComponentSource("app/components/layout/sidebar/sidebar-menu-item.tsx")

  return (
    <main id="main" className="w-full max-w-[680px] px-6 pt-10 pb-24 md:pt-28">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-[28px] leading-8 font-semibold tracking-tight">
            Sidebar Menu Item
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-5">
            The canonical static navigation row of the app sidebar: leading
            glyph slot, truncating label, hover-revealed trailing content, and
            link or button rendering. Geometry comes from the shared
            --sidebar-* tokens pinned by sidebar-geometry.test.ts.
          </p>
        </div>
        <ComponentPager slug="sidebar-menu-item" />
      </header>

      <section aria-labelledby="states-heading" className="mt-10">
        <h2 id="states-heading" className="text-base font-semibold">
          States
        </h2>
        <div className="mt-3">
          <ComponentPreview code={statesCode} sourceCode={sidebarMenuItemSource}>
            <SidebarMenuItemStates />
          </ComponentPreview>
        </div>
      </section>

      <section aria-labelledby="trailing-heading" className="mt-16">
        <h2 id="trailing-heading" className="text-base font-semibold">
          Trailing content
        </h2>
        <div className="mt-3">
          <ComponentPreview code={trailingCode} sourceCode={sidebarMenuItemSource}>
            <SidebarMenuItemTrailing />
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
              <col className="w-[20%]" />
              <col className="w-[24%]" />
              <col className="w-[12%]" />
              <col className="w-[44%]" />
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
                  <TableCell className="px-3 font-mono text-xs font-medium">
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
          Remaining button attributes are forwarded when the row renders as a
          button. For editable list rows (rename, trailing actions, status),
          see SidebarRow in app/components/layout/sidebar/sidebar-row.tsx.
        </p>
      </section>
    </main>
  )
}
