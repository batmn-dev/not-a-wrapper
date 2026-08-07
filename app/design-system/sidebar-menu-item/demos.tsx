"use client"

import { SidebarMenuItem } from "@/app/components/layout/sidebar/sidebar-menu-item"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  RiAddCircleFill,
  RiAddCircleLine,
  RiSearchLine,
  RiSettings3Line,
} from "@remixicon/react"
import type { ReactNode } from "react"

/**
 * Client-side demos: `icon` takes a component, which cannot cross the
 * server/client boundary from the page, so the examples live here.
 */

function SidebarDemoColumn({ children }: { children: ReactNode }) {
  return (
    <div className="bg-sidebar w-(--sidebar-width) max-w-full rounded-lg py-1">
      {children}
    </div>
  )
}

export function SidebarMenuItemStates() {
  return (
    <SidebarDemoColumn>
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
    </SidebarDemoColumn>
  )
}

export function SidebarMenuItemTrailing() {
  return (
    <SidebarDemoColumn>
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
    </SidebarDemoColumn>
  )
}
