"use client"

import { SidebarMenuItem } from "@/app/components/layout/sidebar/sidebar-menu-item"
import { designSystemComponents } from "@/app/design-system/_lib/catalog"
import { NawIcon } from "@/components/icons/naw"
import { CollapsibleSection } from "@/components/ui/collapsible-section"
import { Sidebar } from "@/components/ui/sidebar"
import Link from "next/link"
import { usePathname } from "next/navigation"

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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-(--sidebar-section-first-margin-top) pb-8">
        <nav aria-label="Component navigation">
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
        </nav>
      </div>
    </Sidebar>
  )
}
