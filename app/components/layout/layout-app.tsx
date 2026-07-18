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
          {/* `@container/main` spans the scroll column AND the activity dock slot,
              so the container's inline-size is panel-INDEPENDENT (= viewport −
              sidebar). Opening the panel only redistributes width between the
              column (flex-1) and the slot; the container width never changes, so
              the thread's container-query tiers (gutter + max-width) cannot flip
              mid-animation and the conversation reflows continuously at EVERY
              viewport. This realizes ChatGPT's stated goal — "continuous
              width-only reflow, no discrete max-width flip during the sweep"
              (research/activity-panel-open-close-animation.md) — universally,
              rather than only where the tiers happen to sit outside the sweep
              range (ChatGPT keys its tiers off the panel-dependent column, so its
              own reflow is smooth only at widths where the column stays above the
              @w-lg/512px flip; ours holds at all widths by construction). */}
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
