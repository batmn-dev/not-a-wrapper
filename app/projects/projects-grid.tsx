"use client"

import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"
import {
  RiArrowDownLine,
  RiArrowUpDownLine,
  RiArrowUpLine,
} from "@remixicon/react"
import { useRef, useState, type KeyboardEvent } from "react"
import { ProjectRow } from "./project-row"
import { projectsGridColumnsClassName } from "./projects-grid-columns"

/** The directory row shape (a `projects` doc as the per-user query returns it). */
export type DirectoryProject = {
  _id: Id<"projects">
  name: string
  _creationTime: number
  pinned?: boolean
}

export type ProjectSortColumn = "name" | "modified"
export type ProjectSortDirection = "asc" | "desc"

type ProjectsGridProps = {
  projects: DirectoryProject[]
  sortColumn: ProjectSortColumn
  sortDirection: ProjectSortDirection
  onSort: (column: ProjectSortColumn) => void
  onTogglePinned: (project: DirectoryProject) => void
  isPinPending: (projectId: Id<"projects">) => boolean
}

type RovingTarget =
  | { type: "header"; column: ProjectSortColumn }
  | { type: "row"; projectId: Id<"projects"> }

function SortIcon({
  active,
  direction,
}: {
  active: boolean
  direction: ProjectSortDirection
}) {
  const SortGlyph = active
    ? direction === "asc"
      ? RiArrowUpLine
      : RiArrowDownLine
    : RiArrowUpDownLine
  return <SortGlyph className="size-3.5" aria-hidden />
}

/**
 * The directory list with the reference's grid semantics: `grid` >
 * header `row` (Name / Modified / visually-hidden Actions) > `rowgroup` of
 * project rows separated by hairline dividers. Callers render it only when
 * there are rows — the reference drops the column header entirely for empty
 * and no-result states.
 */
export function ProjectsGrid({
  projects,
  sortColumn,
  sortDirection,
  onSort,
  onTogglePinned,
  isPinPending,
}: ProjectsGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null)
  const headerRefs = useRef<
    Partial<Record<ProjectSortColumn, HTMLButtonElement | null>>
  >({})
  const [rovingTarget, setRovingTarget] = useState<RovingTarget>(() => ({
    type: "row",
    projectId: projects[0]._id,
  }))

  const effectiveRovingTarget: RovingTarget =
    rovingTarget.type === "row" &&
    !projects.some((project) => project._id === rovingTarget.projectId)
      ? { type: "row", projectId: projects[0]._id }
      : rovingTarget

  const focusHeader = (column: ProjectSortColumn) => {
    setRovingTarget({ type: "header", column })
    headerRefs.current[column]?.focus()
  }

  const getRows = () =>
    Array.from(
      gridRef.current?.querySelectorAll<HTMLElement>(
        '[data-project-row="true"]'
      ) ?? []
    )

  const focusRowAt = (index: number) => {
    const rows = getRows()
    const row = rows[Math.max(0, Math.min(index, rows.length - 1))]
    const projectId = row?.dataset.projectId as Id<"projects"> | undefined
    if (!row || !projectId) return
    setRovingTarget({ type: "row", projectId })
    row.focus()
  }

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const row = target.closest<HTMLElement>('[data-project-row="true"]')
    const action = target.closest<HTMLElement>(
      '[data-project-row-action="true"]'
    )
    const header = target.closest<HTMLElement>(
      '[data-page-table-header-focus-target="true"]'
    )

    if (event.key === "Escape" && row && action) {
      event.preventDefault()
      row.focus()
      return
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (header) {
        event.preventDefault()
        focusHeader(header.dataset.sortColumn === "name" ? "modified" : "name")
        return
      }

      if (!row) return
      const actions = Array.from(
        row.querySelectorAll<HTMLElement>('[data-project-row-action="true"]')
      )
      const actionIndex = action ? actions.indexOf(action) : -1
      if (event.key === "ArrowRight") {
        const nextAction = actions[actionIndex + 1]
        if (nextAction) {
          event.preventDefault()
          nextAction.focus()
        }
      } else if (actionIndex > 0) {
        event.preventDefault()
        actions[actionIndex - 1]?.focus()
      } else if (actionIndex === 0) {
        event.preventDefault()
        row.focus()
      }
      return
    }

    if (header && event.key === "ArrowDown") {
      event.preventDefault()
      focusRowAt(0)
      return
    }

    if (!row || action) return
    const rows = getRows()
    const rowIndex = rows.indexOf(row)

    if (event.key === "ArrowUp") {
      event.preventDefault()
      if (rowIndex === 0) focusHeader(sortColumn)
      else focusRowAt(rowIndex - 1)
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      focusRowAt(rowIndex + 1)
    } else if (event.key === "Home") {
      event.preventDefault()
      focusRowAt(0)
    } else if (event.key === "End") {
      event.preventDefault()
      focusRowAt(rows.length - 1)
    } else if (event.key === "F10" || event.key === "ContextMenu") {
      event.preventDefault()
      const menuTrigger = row.querySelector<HTMLButtonElement>(
        '[data-project-menu-trigger="true"]'
      )
      menuTrigger?.focus()
      menuTrigger?.click()
    }
  }

  const renderSortHeader = (
    column: ProjectSortColumn,
    label: string,
    className?: string
  ) => {
    const isActive = sortColumn === column
    const isRoving =
      effectiveRovingTarget.type === "header" &&
      effectiveRovingTarget.column === column
    const ariaSort = isActive
      ? sortDirection === "asc"
        ? "ascending"
        : "descending"
      : "none"

    return (
      <div
        role="columnheader"
        aria-sort={ariaSort}
        className={cn("min-w-0", className)}
      >
        <button
          ref={(element) => {
            headerRefs.current[column] = element
          }}
          type="button"
          tabIndex={isRoving ? 0 : -1}
          data-page-table-header-focus-target="true"
          data-page-table-header-cell-focus-target="true"
          data-sort-column={column}
          onFocus={() => setRovingTarget({ type: "header", column })}
          onClick={() => onSort(column)}
          aria-label={`${label}, sorted ${ariaSort}. Activate to sort ${
            isActive && sortDirection === "asc" ? "descending" : "ascending"
          }.`}
          className="focus-visible:ring-focus-ring -m-1 inline-flex min-w-0 items-center gap-1 rounded-sm p-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        >
          <span className="truncate">{label}</span>
          <SortIcon active={isActive} direction={sortDirection} />
        </button>
      </div>
    )
  }

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label="Projects"
      onKeyDown={handleGridKeyDown}
    >
      <div
        role="row"
        data-page-table-list-header="true"
        className={cn(
          projectsGridColumnsClassName,
          "text-muted-foreground relative h-[42px] items-center overflow-visible py-3 ps-0 pe-2 text-sm/[18px]"
        )}
      >
        {renderSortHeader("name", "Name")}
        {renderSortHeader("modified", "Modified", "hidden text-start sm:block")}
        <div role="columnheader" className="justify-self-end">
          <span className="sr-only">Actions</span>
        </div>
      </div>
      <div
        role="rowgroup"
        data-page-table-row-group="true"
        className="divide-border flex flex-col divide-y"
      >
        {projects.map((project) => (
          <ProjectRow
            key={project._id}
            project={project}
            tabIndex={
              effectiveRovingTarget.type === "row" &&
              effectiveRovingTarget.projectId === project._id
                ? 0
                : -1
            }
            onRowFocus={() =>
              setRovingTarget({ type: "row", projectId: project._id })
            }
            onTogglePinned={() => onTogglePinned(project)}
            isPinPending={isPinPending(project._id)}
          />
        ))}
      </div>
    </div>
  )
}
