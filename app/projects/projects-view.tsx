"use client"

import { HeaderSidebarTrigger } from "@/app/components/layout/header-sidebar-trigger"
import { DialogCreateProject } from "@/app/components/projects/dialog-create-project"
import {
  useProjectPinning,
  type PinnableProject,
} from "@/app/components/projects/use-project-pinning"
import { Button } from "@/components/ui/button"
import { useScrollRoot } from "@/components/ui/scroll-root"
import { api } from "@/convex/_generated/api"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { cn } from "@/lib/utils"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  ProjectFilterTabs,
  type ProjectsDirectoryTab,
} from "./project-filter-tabs"
import { ProjectSearch } from "./project-search"
import { ProjectsGrid, type DirectoryProject } from "./projects-grid"
import { ProjectIcon } from "./project-icon"

/**
 * Front-end-only boundary: `shared` has no backend yet (no sharing tables or
 * queries exist). This constant is the slot a future shared-projects query
 * replaces — the tab → source mapping below is the only place that changes.
 */
const NO_SHARED_PROJECTS: DirectoryProject[] = []

/**
 * The directory's filter/data boundary: one place resolves the active tab to a
 * project source, then applies the client-side search. `all` and `created`
 * both read the owned-projects per-user query (ownership is the only concept
 * the backend has); `shared` is an honest empty source.
 */
type DirectoryViewState = {
  tab: ProjectsDirectoryTab
  query: string
}

const DEFAULT_DIRECTORY_STATE: DirectoryViewState = {
  tab: "all",
  query: "",
}

const projectNewButtonClassName =
  "border border-transparent bg-[#0d0d0d] hover:bg-[#2f2f2f] focus-visible:ring-0 focus-visible:outline-[1.5px] focus-visible:outline-offset-[2.5px] focus-visible:outline-foreground focus-visible:[outline-style:solid] dark:bg-white dark:hover:bg-[#e8e8e8]"

function parseDirectoryViewState(searchParams: URLSearchParams) {
  const tabParam = searchParams.get("tab")
  const tab: ProjectsDirectoryTab =
    tabParam === "created" || tabParam === "shared" ? tabParam : "all"

  return {
    tab,
    query: searchParams.get("q") ?? "",
  }
}

function useProjectsDirectoryViewState() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchParamsKey = searchParams.toString()
  const parsedUrlState = parseDirectoryViewState(
    new URLSearchParams(searchParamsKey)
  )
  const [viewState, setViewState] = useState<DirectoryViewState>(parsedUrlState)
  const [lastSearchParamsKey, setLastSearchParamsKey] =
    useState(searchParamsKey)

  // React 19 render-time resynchronization: browser back/forward and refresh
  // restore the view without an effect or a second source of truth.
  if (searchParamsKey !== lastSearchParamsKey) {
    setLastSearchParamsKey(searchParamsKey)
    setViewState(parsedUrlState)
  }

  const { tab, query } = viewState

  const updateUrl = (
    nextState: DirectoryViewState,
    historyMode: "push" | "replace"
  ) => {
    const nextParams = new URLSearchParams(searchParamsKey)
    if (nextState.tab === DEFAULT_DIRECTORY_STATE.tab) nextParams.delete("tab")
    else nextParams.set("tab", nextState.tab)

    if (nextState.query) nextParams.set("q", nextState.query)
    else nextParams.delete("q")
    nextParams.delete("sort")

    const nextQueryString = nextParams.toString()
    const href = nextQueryString ? `${pathname}?${nextQueryString}` : pathname
    router[historyMode](href, { scroll: false })
  }

  const setTab = (nextTab: ProjectsDirectoryTab) => {
    const nextState = { ...viewState, tab: nextTab }
    setViewState(nextState)
    updateUrl(nextState, "push")
  }

  const setQuery = (nextQuery: string) => {
    const nextState = { ...viewState, query: nextQuery }
    setViewState(nextState)
    // Search updates are replace-only so typing does not create one history
    // entry per character; tab transitions remain back-button navigable.
    updateUrl(nextState, "replace")
  }

  return {
    tab,
    setTab,
    query,
    setQuery,
  }
}

function useProjectsDirectory(
  tab: ProjectsDirectoryTab,
  query: string,
  isPinned: (project: PinnableProject) => boolean
) {
  const { data: ownedProjects, isLoading: isOwnedLoading } = usePerUserQuery(
    api.projects.getForCurrentUser
  )

  const tabSource: DirectoryProject[] | undefined =
    tab === "shared" ? NO_SHARED_PROJECTS : ownedProjects
  const isLoading = tab === "shared" ? false : isOwnedLoading

  const normalizedQuery = query.trim().toLowerCase()
  const visibleProjects = useMemo(() => {
    if (!tabSource) return undefined
    const projectsWithPinState = tabSource.map((project) => ({
      ...project,
      pinned: isPinned(project),
    }))
    const matches = normalizedQuery
      ? projectsWithPinState.filter((project) =>
          (project.name || "Untitled Project")
            .toLowerCase()
            .includes(normalizedQuery)
        )
      : projectsWithPinState

    return [...matches].sort((a, b) => {
      const pinOrder = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
      if (pinOrder !== 0) return pinOrder

      return b.updatedAt - a.updatedAt
    })
  }, [isPinned, normalizedQuery, tabSource])

  return {
    isLoading,
    hasQuery: normalizedQuery.length > 0,
    visibleProjects,
  }
}

function DirectoryEmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="px-0 py-16 text-center md:px-6">
      <ProjectIcon empty />
      <p className="text-foreground text-base/6 font-medium">{title}</p>
      <p className="text-muted-foreground mt-2 text-sm/5">{description}</p>
    </div>
  )
}

/**
 * Render-time query failures (the Convex subscription throwing) land here
 * instead of unmounting the whole app shell.
 */
class DirectoryErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <DirectoryEmptyState
          title="Projects couldn't load"
          description="Something went wrong. Refresh the page to try again."
        />
      )
    }
    return this.props.children
  }
}

type ProjectsDirectoryListProps = Pick<DirectoryViewState, "tab" | "query"> &
  Pick<
    ReturnType<typeof useProjectPinning>,
    "isPinned" | "isPinPending" | "togglePinned"
  >

function ProjectsDirectoryList({
  tab,
  query,
  isPinned,
  isPinPending,
  togglePinned,
}: ProjectsDirectoryListProps) {
  const directory = useProjectsDirectory(tab, query, isPinned)

  if (directory.isLoading || directory.visibleProjects === undefined) {
    // Auth sync / query in flight: render neither rows nor a false empty state.
    return null
  }
  if (directory.visibleProjects.length > 0) {
    return (
      <ProjectsGrid
        projects={directory.visibleProjects}
        onTogglePinned={togglePinned}
        isPinPending={isPinPending}
      />
    )
  }
  if (directory.hasQuery || tab === "shared") {
    return (
      <DirectoryEmptyState
        title="No matching projects"
        description="Try a different search or tab."
      />
    )
  }
  return (
    <DirectoryEmptyState
      title="No projects yet"
      description="Create a project to keep related chats together."
    />
  )
}

/**
 * The /projects directory. Owns the page's whole vertical composition in the
 * app scroll root: the mobile compact bar, the heading/search/New row, the
 * sticky filter toolbar (hairline appears once the page scrolls), and the
 * project grid with its loading/empty/no-result states.
 */
export function ProjectsView() {
  const { preferences } = useUserPreferences()
  const hasSidebar = preferences.layout === "sidebar"

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const projectPinning = useProjectPinning()
  const directory = useProjectsDirectoryViewState()

  // Same scrolled-signal pattern as the chat Header: drives the mobile bar's
  // sharp-edge shadow.
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

  // A 1px sentinel shows the divider only while the list passes behind the
  // sticky toolbar. On mobile it exits below the 52px compact header.
  const isMobile = useBreakpoint(768)
  const toolbarSentinelRef = useRef<HTMLDivElement | null>(null)
  const [isToolbarStuck, setIsToolbarStuck] = useState(false)
  useEffect(() => {
    const sentinel = toolbarSentinelRef.current
    const root = scrollRef.current
    if (!sentinel || !root) return
    const observer = new IntersectionObserver(
      ([entry]) => setIsToolbarStuck(!entry.isIntersecting),
      { root, rootMargin: isMobile ? "-52px 0px 0px 0px" : "0px" }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [scrollRef, isMobile])

  return (
    <div className="flex w-full flex-col [--projects-content-max-width:50rem] [--projects-control-fill:#f3f3f3] [--projects-control-surface:#fff] dark:[--projects-control-fill:#414141] dark:[--projects-control-surface:#212121]">
      {/* Mobile compact bar (captured: 52px, menu trigger + bold title + New). */}
      <div
        className="bg-background h-app-header sticky top-0 z-10 flex shrink-0 items-center justify-between gap-2 px-2 [box-shadow:var(--sharp-edge-top-shadow-placeholder)] data-[scrolled]:[box-shadow:var(--sharp-edge-top-shadow)] md:hidden"
        data-scrolled={isScrolled || undefined}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {hasSidebar && <HeaderSidebarTrigger />}
          <h1 className="text-foreground min-w-0 truncate text-2xl leading-[30px] font-semibold tracking-[-0.5px]">
            Projects
          </h1>
        </div>
        <div className="flex shrink-0 items-center justify-center pe-2">
          <Button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className={projectNewButtonClassName}
          >
            New
          </Button>
        </div>
      </div>

      {/* Heading + search + New (heading and button are desktop-only; mobile
          keeps a full-width search row under the compact bar). */}
      <div className="mx-auto flex w-full max-w-(--projects-content-max-width) flex-col px-4 pt-4 pb-6 md:pt-10 md:pb-10">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-4 md:mt-9 md:min-h-19 md:items-end">
          <h1 className="text-heading-app text-foreground hidden min-w-0 flex-1 font-normal md:flex md:h-9 md:items-center">
            Projects
          </h1>
          <div className="flex w-full min-w-0 flex-nowrap items-center gap-3 md:ms-auto md:w-auto">
            <div className="min-w-0 flex-1 max-md:max-w-[400px] md:w-60 md:flex-none">
              <ProjectSearch
                value={directory.query}
                onValueChange={directory.setQuery}
              />
            </div>
            <div className="hidden shrink-0 md:block">
              <Button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className={projectNewButtonClassName}
              >
                New
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Stuck-detection sentinel (the reference's `-mb-px h-px` marker). */}
      <div
        ref={toolbarSentinelRef}
        aria-hidden="true"
        className="pointer-events-none -mb-px h-px"
      />

      {/* Sticky filter toolbar; the full-bleed hairline divider appears only
          while the toolbar is pinned with content scrolled beneath it. Sticks
          below the compact bar on mobile. */}
      <div
        className={cn(
          "bg-background sticky top-0 z-20 border-b max-md:top-(--header-height)",
          isToolbarStuck ? "border-border" : "border-transparent"
        )}
        data-testid="projects-toolbar"
      >
        <div className="mx-auto flex w-full max-w-(--projects-content-max-width) px-4">
          <div className="flex min-h-(--projects-toolbar-min-height) w-full items-center py-2">
            <ProjectFilterTabs
              tab={directory.tab}
              onTabChange={directory.setTab}
            />
          </div>
        </div>
      </div>

      {/* List column. */}
      <div className="mx-auto flex w-full max-w-(--projects-content-max-width) flex-1 flex-col px-4 pb-8">
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <DirectoryErrorBoundary>
            <ProjectsDirectoryList
              tab={directory.tab}
              query={directory.query}
              isPinned={projectPinning.isPinned}
              isPinPending={projectPinning.isPinPending}
              togglePinned={projectPinning.togglePinned}
            />
          </DirectoryErrorBoundary>
        </div>
      </div>

      <DialogCreateProject isOpen={isCreateOpen} setIsOpen={setIsCreateOpen} />
    </div>
  )
}
