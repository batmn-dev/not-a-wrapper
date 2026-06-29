"use client"

import {
  ActivityPanelDockSlot,
  ActivityPanelHostProvider,
} from "@/app/components/chat/activity/activity-panel-host"
import { Header } from "@/app/components/layout/header"
import { HistorySearchProvider } from "@/app/components/history/history-search-provider"
import { AppSidebar } from "@/app/components/layout/sidebar/app-sidebar"
import { ScrollRoot } from "@/components/ui/scroll-root"
import { useUserPreferences } from "@/lib/user-preference-store/provider"

export function LayoutApp({ children }: { children: React.ReactNode }) {
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
              <ScrollRoot className="min-w-0 [--sticky-padding-top:var(--spacing-app-header)] @7xl/main:[--sticky-padding-top:0px] scroll-pt-[var(--sticky-padding-top)] [scrollbar-gutter:stable] @[40rem]/main:[scrollbar-gutter:stable_both-edges] pointer-coarse:[scrollbar-width:none] print:overflow-visible">
                <Header hasSidebar={hasSidebar} />
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
