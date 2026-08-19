"use client"

import { designSystemComponents } from "@/app/design-system/_lib/catalog"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { usePathname } from "next/navigation"

/**
 * Registry navigation below `md`, where the sidebar chrome is hidden: a
 * sticky, horizontally scrollable chip bar. Chips reuse the sidebar row
 * hover/active tint token so both navs read as one system.
 */
export function DesignSystemMobileNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Component navigation"
      className="bg-muted/90 sticky top-0 z-30 flex gap-1 overflow-x-auto border-b px-3 py-2 backdrop-blur-sm md:hidden"
    >
      {designSystemComponents.map((component) => {
        const isCurrent = pathname === component.href

        return (
          <Link
            key={component.slug}
            href={component.href}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "hover:bg-sidebar-row hover:text-foreground flex h-8 shrink-0 items-center rounded-full px-3 text-sm whitespace-nowrap",
              isCurrent
                ? "bg-sidebar-row text-foreground"
                : "text-muted-foreground"
            )}
          >
            {component.name}
          </Link>
        )
      })}
    </nav>
  )
}
