"use client"

import { AuthModalTrigger } from "@/app/auth/_components/auth-modal"
import { HistoryTrigger } from "@/app/components/history/history-trigger"
import { ButtonNewChat } from "@/app/components/layout/button-new-chat"
import { UserMenu } from "@/app/components/layout/user-menu"
import { NawIcon } from "@/components/icons/naw"
import { useScrollRoot } from "@/components/ui/scroll-root"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { APP_NAME } from "@/lib/config"
import { useUser } from "@/lib/user-store/provider"
import Link from "next/link"
import { useEffect, useState } from "react"
import { DialogPublish } from "./dialog-publish"
import { HeaderSidebarTrigger } from "./header-sidebar-trigger"

export function Header({ hasSidebar }: { hasSidebar: boolean }) {
  const isMobile = useBreakpoint(768)

  const { user } = useUser()

  const isLoggedIn = !!user

  const { scrollRef } = useScrollRoot()
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setIsScrolled(el.scrollTop > 0)
    el.addEventListener("scroll", onScroll, { passive: true })
    onScroll()
    return () => el.removeEventListener("scroll", onScroll)
  }, [scrollRef])

  return (
    <header
      className="h-app-header bg-background pointer-events-none sticky top-0 z-20 shrink-0 [box-shadow:var(--sharp-edge-top-shadow-placeholder)] data-[scrolled]:[box-shadow:var(--sharp-edge-top-shadow)] data-[fixed-header=less-than-xl]:@7xl/main:bg-transparent data-[fixed-header=less-than-xl]:@7xl/main:[box-shadow:none]! data-[fixed-header=less-than-xxl]:@[96rem]/main:bg-transparent data-[fixed-header=less-than-xxl]:@[96rem]/main:[box-shadow:none]!"
      data-fixed-header="less-than-xl"
      data-scrolled={isScrolled || undefined}
    >
      <div className="relative mx-auto flex h-full max-w-full items-center justify-between px-2 pointer-coarse:px-2.5">
        {/* LEFT SECTION - natural width, not flex-1 */}
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

        {/* RIGHT SECTION - natural width, not flex-1 */}
        <div className="flex shrink-0 items-center justify-end gap-0 [&>*]:pointer-events-auto">
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
      </div>
    </header>
  )
}
