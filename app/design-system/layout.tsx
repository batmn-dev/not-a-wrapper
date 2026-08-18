import { DesignSystemMobileNav } from "@/app/design-system/_components/design-system-mobile-nav"
import { DesignSystemSidebar } from "@/app/design-system/_components/design-system-sidebar"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Design System",
  robots: {
    index: false,
    follow: false,
  },
}

export default function DesignSystemLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div className="bg-muted text-foreground flex min-h-svh w-full min-w-0 [--sidebar:var(--muted)]">
      <DesignSystemSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <DesignSystemMobileNav />
        {/* Balances the docked sidebar's width so the page column stays
            centered on wide viewports. */}
        <div className="flex min-w-0 flex-1 justify-center xl:pr-(--sidebar-width)">
          {children}
        </div>
      </div>
    </div>
  )
}
