"use client"

import {
  ActivityPanelDockSlot,
  ActivityPanelHostProvider,
} from "@/app/components/chat/activity/activity-panel-host"
import { HistorySearchProvider } from "@/app/components/history/history-search-provider"
import { Header } from "@/app/components/layout/header"
import { AppSidebar } from "@/app/components/layout/sidebar/app-sidebar"
import { ScrollRoot } from "@/components/ui/scroll-root"
import { useUserPreferences } from "@/lib/user-preference-store/provider"

export function LayoutApp({
  children,
  header,
}: {
  children: React.ReactNode
  /**
   * Page-header slot: `undefined` renders the default chat `<Header/>`; `null`
   * lets a page own its header composition (e.g. /projects renders its own
   * in-flow compact bar) without pathname conditionals in the shell.
   *
   * Chat-bearing routes MUST pass `<ChatChromeHeader/>` inside a
   * `<ChatChromeProvider/>` (ADR-0017): their visible surface flips on client
   * state within shallow route handoffs, which a static slot cannot follow —
   * and the header must render HERE, before the `<main>` landmark, so the
   * skip-to-content link bypasses it and it keeps its implicit banner role.
   * Never render the app header inside `<main>`.
   */
  header?: React.ReactNode
}) {
  const { preferences } = useUserPreferences()
  const hasSidebar = preferences.layout === "sidebar"

  return (
    <HistorySearchProvider>
      <ActivityPanelHostProvider>
        <div className="flex h-svh w-full overflow-hidden">
          {hasSidebar && <AppSidebar />}
          {/* The container spans the scroll column and activity dock, so opening
              the panel redistributes width without crossing container-query tiers. */}
          <div className="@container/main relative flex min-w-0 flex-1">
            <div className="relative flex min-w-0 flex-1 flex-col">
              <ScrollRoot className="@[40rem]/main:[scrollbar-gutter:stable_both-edges] print:overflow-visible pointer-coarse:[scrollbar-width:none]">
                {header === undefined ? <Header hasSidebar={hasSidebar} /> : header}
                <main id="main" className="min-h-0 flex-1">
                  {children}
                </main>
              </ScrollRoot>
            </div>
            {/* Activity panel docked track — a flex sibling of the scroll column
                INSIDE the shared `@container/main` row, so it pushes the column
                narrower without changing the container width. The scroll
                machinery (ScrollRoot, composer, --thread-bottom-offset) does not
                move (GA §7 R4). Collapsed to w-0 when closed / below lg. */}
            <ActivityPanelDockSlot />
          </div>
        </div>
      </ActivityPanelHostProvider>
    </HistorySearchProvider>
  )
}
