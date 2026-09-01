"use client"

import {
  ActivityPanelDockSlot,
  ActivityPanelHostProvider,
} from "@/app/components/chat/activity/activity-panel-host"
import { HistorySearchProvider } from "@/app/components/history/history-search-provider"
import { Header } from "@/app/components/layout/header"
import { AppSidebar } from "@/app/components/layout/sidebar/app-sidebar"
import { ProjectPinningProvider } from "@/app/components/projects/use-project-pinning"
import { MainContent } from "@/components/ui/main-content"
import { ScrollRoot } from "@/components/ui/scroll-root"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { Fragment } from "react"

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
      <ProjectPinningProvider>
        <ActivityPanelHostProvider>
          <div className="flex h-svh w-screen flex-col pt-[env(safe-area-inset-top,0px)]">
            <div className="relative z-0 flex min-h-0 w-full flex-1">
              <div className="relative flex min-h-0 w-full min-w-0 flex-1">
                {hasSidebar && <AppSidebar />}
                <div className="@container/main relative flex min-w-0 flex-1 -translate-y-[calc(env(safe-area-inset-bottom,0px)/2)] flex-col pt-[calc(env(safe-area-inset-bottom,0px)/2)]">
                  <ScrollRoot>
                    <Fragment key="app-header">
                      {header === undefined ? (
                        <Header
                          hasSidebar={hasSidebar}
                          fixedHeader="less-than-xl"
                        />
                      ) : (
                        header
                      )}
                    </Fragment>
                    <div className="side-pane-shell-host relative flex min-h-0 flex-1 items-start">
                      <MainContent
                        id="main"
                        className="@container/main min-h-0 min-w-0 flex-1 self-stretch"
                      >
                        {children}
                      </MainContent>
                      <ActivityPanelDockSlot />
                    </div>
                  </ScrollRoot>
                </div>
              </div>
            </div>
          </div>
        </ActivityPanelHostProvider>
      </ProjectPinningProvider>
    </HistorySearchProvider>
  )
}
