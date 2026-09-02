"use client"

import { AuthModalTrigger } from "@/app/auth/_components/auth-modal"
import { HistoryTrigger } from "@/app/components/history/history-trigger"
import { ButtonNewChat } from "@/app/components/layout/button-new-chat"
import { UserMenu } from "@/app/components/layout/user-menu"
import { NawIcon } from "@/components/icons/naw"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { APP_NAME } from "@/lib/config"
import { useUser } from "@/lib/user-store/provider"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { DialogPublish } from "./dialog-publish"
import { HeaderSidebarTrigger } from "./header-sidebar-trigger"

export type HeaderFixedMode =
  "always" | "less-than-md" | "less-than-xl" | "less-than-xxl" | "never"

export function Header({
  hasSidebar,
  fixedHeader,
}: {
  hasSidebar: boolean
  fixedHeader: HeaderFixedMode
}) {
  const isMobile = useBreakpoint(768)

  const { user } = useUser()

  const isLoggedIn = !!user

  return (
    <header
      id="page-header"
      className={cn(
        "draggable no-draggable-children h-header-height touch:p-2.5 pointer-events-none sticky top-0 z-20 flex items-center justify-between p-2 transition-none select-none [view-transition-name:var(--vt-page-header)] *:pointer-events-auto motion-safe:transition-none",
        fixedHeader === "never"
          ? "bg-transparent shadow-none"
          : "bg-background [box-shadow:var(--sharp-edge-top-shadow-placeholder)] group-data-scroll-from-top/scroll-root:[box-shadow:var(--sharp-edge-top-shadow)]",
        "data-[fixed-header=less-than-md]:md:bg-transparent data-[fixed-header=less-than-md]:md:[box-shadow:none]!",
        "data-[fixed-header=less-than-xl]:@w-xl/main:bg-transparent data-[fixed-header=less-than-xl]:@w-xl/main:[box-shadow:none]!",
        "data-[fixed-header=less-than-xxl]:@w-2xl/main:bg-transparent data-[fixed-header=less-than-xxl]:@w-2xl/main:[box-shadow:none]!"
      )}
      data-fixed-header={fixedHeader}
    >
      <div className="flex shrink-0 items-center gap-2">
        {/* Hide logo/text when sidebar is present on desktop (sidebar has its own home link) */}
        {!hasSidebar && (
          <Link
            href="/"
            className="pointer-events-auto inline-flex items-center text-lg font-medium tracking-tight"
          >
            <NawIcon className="mr-1 size-4" />
            {APP_NAME}
          </Link>
        )}
        {/* Show toggle only on mobile (collapsed rail has its own toggle on desktop) */}
        {hasSidebar && isMobile && <HeaderSidebarTrigger />}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-0">
        {!isLoggedIn ? (
          <div className="flex items-center gap-2">
            <AuthModalTrigger variant="outline">Log in</AuthModalTrigger>
            <AuthModalTrigger className="max-[360px]:hidden">
              Sign up
            </AuthModalTrigger>
          </div>
        ) : (
          <>
            {!isMobile && <DialogPublish />}
            <ButtonNewChat />
            {!hasSidebar && <HistoryTrigger hasSidebar={hasSidebar} />}
            {!hasSidebar && <UserMenu />}
          </>
        )}
      </div>
    </header>
  )
}
