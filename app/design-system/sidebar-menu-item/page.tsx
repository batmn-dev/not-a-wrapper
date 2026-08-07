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
    type: 'IconProps["icon"]',
    defaultValue: "—",
    description:
      "Optional leading glyph, rendered through the shared SidebarLeadingIcon geometry slot.",
  },
  {
    prop: "activeIcon",
    type: 'IconProps["icon"]',
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
  const sidebarMenuItemSource = readComponentSource(
    "app/components/layout/sidebar/sidebar-menu-item.tsx"
  )

  return (
    <DsPage>
      <DsPageHeader
        slug="sidebar-menu-item"
        title="Sidebar Menu Item"
        description="The app sidebar's static navigation row: leading glyph, truncating label, hover-revealed trailing content, link or button rendering."
      />

      <DsSection id="states" title="States">
        <ComponentPreview code={statesCode} sourceCode={sidebarMenuItemSource}>
          <SidebarMenuItemStates />
        </ComponentPreview>
      </DsSection>

      <DsSection id="trailing" title="Trailing content">
        <ComponentPreview
          code={trailingCode}
          sourceCode={sidebarMenuItemSource}
        >
          <SidebarMenuItemTrailing />
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[20, 24, 12, 44]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining button attributes are forwarded when the row renders as a
          button. For editable list rows (rename, trailing actions, status), see
          SidebarRow in app/components/layout/sidebar/sidebar-row.tsx.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
