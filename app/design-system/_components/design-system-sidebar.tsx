"use client"

import { SidebarMenuItem } from "@/app/components/layout/sidebar/sidebar-menu-item"
import { designSystemComponents } from "@/app/design-system/_lib/catalog"
import { NawIcon } from "@/components/icons/naw"
import { CollapsibleSection } from "@/components/ui/collapsible-section"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Sidebar } from "@/components/ui/sidebar"
import { RiSearchLine } from "@remixicon/react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

/**
 * Doc-site navigation chrome for the design-system registry, composed from
 * the canonical sidebar vocabulary (ADR-0018): production `SidebarMenuItem`
 * rows inside a `CollapsibleSection variant="sidebar"` section header, docked
 * with the app sidebar's border treatment. Deliberate divergences from the
 * app shell: no collapse (this sidebar is static, so faking a toggle would
 * demonstrate behavior the surface doesn't have) and no mobile drawer (below
 * `md` the registry navigates through DesignSystemMobileNav's chip bar).
 */
export function DesignSystemSidebar() {
  const pathname = usePathname()
  const [query, setQuery] = useState("")

  const normalizedQuery = query.trim().toLowerCase()
  const filteredComponents = designSystemComponents.filter((component) =>
    component.name.toLowerCase().includes(normalizedQuery)
  )

  return (
    <Sidebar
      collapsible="none"
      role="complementary"
      aria-label="Design system"
      className="border-sidebar-border sticky top-0 hidden h-svh border-r md:flex"
    >
      {/* Header mirrors the app sidebar's structure and height token; the
          logo links back out of the registry. No collapse trigger. */}
      <div className="px-2">
        <div className="flex h-(--sidebar-header-height) items-center">
          <Link
            href="/"
            className="hover:bg-sidebar-row active:bg-sidebar-row flex h-9 w-9 items-center justify-center rounded-lg"
            aria-label="Home"
          >
            <NawIcon className="size-5" />
          </Link>
        </div>
      </div>
      {/* Search sits where the app sidebar docks its action rows (New chat /
          Search): directly below the header, aligned to the row inset. */}
      <div className="px-(--sidebar-row-outer-inset) pt-(--sidebar-section-first-margin-top)">
        <div className="relative">
          <Icon
            icon={RiSearchLine}
            slotSize={16}
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
          />
          <Input
            type="search"
            placeholder="Search"
            aria-label="Search components"
            className="h-9 pl-7 text-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-(--sidebar-section-stack-margin-top) pb-8">
        <nav aria-label="Component navigation">
          {/* An active query bypasses the collapsible so a collapsed section
              can't hide matches. */}
          {normalizedQuery ? (
            filteredComponents.length > 0 ? (
              filteredComponents.map((component) => (
                <SidebarMenuItem
                  key={component.slug}
                  label={component.name}
                  href={component.href}
                  isActive={pathname === component.href}
                />
              ))
            ) : (
              <p className="text-muted-foreground px-4 py-1.5 text-sm">
                No components found
              </p>
            )
          ) : (
            <CollapsibleSection
              title="Components"
              variant="sidebar"
              storageKey="sidebar-section-design-system-components"
            >
              {designSystemComponents.map((component) => (
                <SidebarMenuItem
                  key={component.slug}
                  label={component.name}
                  href={component.href}
                  isActive={pathname === component.href}
                />
              ))}
            </CollapsibleSection>
          )}
        </nav>
      </div>
    </Sidebar>
  )
}
