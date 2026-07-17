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
import {
  ProjectsGrid,
  type DirectoryProject,
  type ProjectSortColumn,
  type ProjectSortDirection,
} from "./projects-grid"

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
  sortColumn: ProjectSortColumn
  sortDirection: ProjectSortDirection
}

const DEFAULT_DIRECTORY_STATE: DirectoryViewState = {
  tab: "all",
  query: "",
  sortColumn: "modified",
  sortDirection: "desc",
}

function parseDirectoryViewState(searchParams: URLSearchParams) {
  const tabParam = searchParams.get("tab")
  const tab: ProjectsDirectoryTab =
    tabParam === "created" || tabParam === "shared" ? tabParam : "all"
  const [sortParamColumn, sortParamDirection] = (
    searchParams.get("sort") ?? ""
  ).split("-")
  const sortColumn: ProjectSortColumn =
    sortParamColumn === "name" || sortParamColumn === "modified"
      ? sortParamColumn
      : DEFAULT_DIRECTORY_STATE.sortColumn
  const sortDirection: ProjectSortDirection =
    sortParamDirection === "asc" || sortParamDirection === "desc"
      ? sortParamDirection
      : DEFAULT_DIRECTORY_STATE.sortDirection

  return {
    tab,
    query: searchParams.get("q") ?? "",
    sortColumn,
    sortDirection,
  }
}

function useProjectsDirectory(isPinned: (project: PinnableProject) => boolean) {
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

  const { tab, query, sortColumn, sortDirection } = viewState

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

      const comparison =
        sortColumn === "name"
          ? (a.name || "Untitled Project").localeCompare(
              b.name || "Untitled Project",
              undefined,
              { sensitivity: "base" }
            )
          : a._creationTime - b._creationTime
      return sortDirection === "asc" ? comparison : -comparison
    })
  }, [isPinned, normalizedQuery, sortColumn, sortDirection, tabSource])

  const updateUrl = (
    nextState: DirectoryViewState,
    historyMode: "push" | "replace"
  ) => {
    const nextParams = new URLSearchParams(searchParamsKey)
    if (nextState.tab === DEFAULT_DIRECTORY_STATE.tab) nextParams.delete("tab")
    else nextParams.set("tab", nextState.tab)

    if (nextState.query) nextParams.set("q", nextState.query)
    else nextParams.delete("q")

    if (
      nextState.sortColumn === DEFAULT_DIRECTORY_STATE.sortColumn &&
      nextState.sortDirection === DEFAULT_DIRECTORY_STATE.sortDirection
    ) {
      nextParams.delete("sort")
    } else {
      nextParams.set(
        "sort",
        `${nextState.sortColumn}-${nextState.sortDirection}`
      )
    }

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
    // entry per character; tab/sort transitions remain back-button navigable.
    updateUrl(nextState, "replace")
  }

  const setSortColumn = (nextColumn: ProjectSortColumn) => {
    const nextDirection: ProjectSortDirection =
      nextColumn === sortColumn
        ? sortDirection === "asc"
          ? "desc"
          : "asc"
        : nextColumn === "modified"
          ? "desc"
          : "asc"
    const nextState = {
      ...viewState,
      sortColumn: nextColumn,
      sortDirection: nextDirection,
    }
    setViewState(nextState)
    updateUrl(nextState, "push")
  }

  return {
    tab,
    setTab,
    query,
    setQuery,
    sortColumn,
    sortDirection,
    setSortColumn,
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
      <p className="text-foreground text-base/6 font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 text-sm/5">{description}</p>
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
  const directory = useProjectsDirectory(projectPinning.isPinned)

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

  // Toolbar hairline trigger, ChatGPT's sentinel recipe: a 1px marker sits
  // directly above the sticky toolbar, and the divider shows only while the
  // marker has scrolled out under the toolbar's sticky edge — i.e. exactly
  // when the toolbar is pinned with the list sliding beneath it, not on the
  // first scrolled pixel. On mobile the toolbar pins below the 52px compact
  // bar, so the sentinel "exits" 52px (--header-height) before the top.
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

  let listContent: ReactNode = null
  if (directory.isLoading || directory.visibleProjects === undefined) {
    // Auth sync / query in flight: render neither rows nor a false empty state.
    listContent = null
  } else if (directory.visibleProjects.length > 0) {
    listContent = (
      <ProjectsGrid
        projects={directory.visibleProjects}
        sortColumn={directory.sortColumn}
        sortDirection={directory.sortDirection}
        onSort={directory.setSortColumn}
        onTogglePinned={projectPinning.togglePinned}
        isPinPending={projectPinning.isPinPending}
      />
    )
  } else if (directory.hasQuery) {
    listContent = (
      <DirectoryEmptyState
        title="No matching projects"
        description="Try a different search or tab."
      />
    )
  } else if (directory.tab === "shared") {
    listContent = (
      <DirectoryEmptyState
        title="Nothing shared with you"
        description="Project sharing isn't available yet."
      />
    )
  } else {
    listContent = (
      <DirectoryEmptyState
        title="No projects yet"
        description="Create a project to keep related chats together."
      />
    )
  }

  return (
    <div className="flex w-full flex-col">
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
          <Button type="button" onClick={() => setIsCreateOpen(true)}>
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
              <Button type="button" onClick={() => setIsCreateOpen(true)}>
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
        <div className="flex min-h-0 flex-1 flex-col">
          <DirectoryErrorBoundary>{listContent}</DirectoryErrorBoundary>
        </div>
      </div>

      <DialogCreateProject isOpen={isCreateOpen} setIsOpen={setIsCreateOpen} />
    </div>
  )
}
