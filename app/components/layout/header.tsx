"use client"

import { AuthModalTrigger } from "@/app/auth/_components/auth-modal"
import { HistoryTrigger } from "@/app/components/history/history-trigger"
import { ButtonNewChat } from "@/app/components/layout/button-new-chat"
import { UserMenu } from "@/app/components/layout/user-menu"
import { NawIcon } from "@/components/icons/naw"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { APP_NAME } from "@/lib/config"
import { useUser } from "@/lib/user-store/provider"
import Link from "next/link"
import { DialogPublish } from "./dialog-publish"
import { HeaderSidebarTrigger } from "./header-sidebar-trigger"

export type HeaderFixedMode = "always" | "never"

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
      className="h-header-height data-[fixed-header=less-than-xl]:@w-xl/main:bg-transparent data-[fixed-header=less-than-xl]:@w-xl/main:shadow-none pointer-events-none sticky top-0 z-20 flex shrink-0 items-center justify-between bg-transparent p-2 shadow-none transition-none select-none [view-transition-name:var(--vt-page-header)] *:pointer-events-auto pointer-coarse:p-2.5"
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
