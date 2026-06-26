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
          <div className="@container/main relative flex min-w-0 flex-1 flex-col">
            <ScrollRoot className="min-w-0 scroll-pt-[var(--spacing-app-header)] [scrollbar-gutter:stable] @sm/main:[scrollbar-gutter:stable_both-edges] pointer-coarse:[scrollbar-width:none] print:overflow-visible">
              <Header hasSidebar={hasSidebar} />
              <main id="main" className="flex min-h-0 flex-1 flex-col">
                {children}
              </main>
            </ScrollRoot>
          </div>
          {/* Activity panel docked track — a flex sibling of the scroll column.
              Opening it changes only the column's available width; the scroll
              machinery (ScrollRoot, composer, --thread-bottom-offset) does not
              move (GA §7 R4). Collapsed to w-0 when closed / below lg. */}
          <ActivityPanelDockSlot />
        </div>
      </ActivityPanelHostProvider>
    </HistorySearchProvider>
  )
}
