"use client"

import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"
import { useRef, type KeyboardEvent } from "react"
import { ProjectRow } from "./project-row"
import { projectsGridColumnsClassName } from "./projects-grid-columns"

/** The directory row shape (a `projects` doc as the per-user query returns it). */
export type DirectoryProject = {
  _id: Id<"projects">
  name: string
  _creationTime: number
  updatedAt: number
  pinned: boolean
}

type ProjectsGridProps = {
  projects: DirectoryProject[]
  onTogglePinned: (project: DirectoryProject) => void
  isPinPending: (projectId: Id<"projects">) => boolean
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
  onTogglePinned,
  isPinPending,
}: ProjectsGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null)

  const getRows = () =>
    Array.from(
      gridRef.current?.querySelectorAll<HTMLElement>(
        '[data-project-row="true"]'
      ) ?? []
    )

  const getHeaderTargets = () =>
    Array.from(
      gridRef.current?.querySelectorAll<HTMLElement>(
        '[data-page-table-header-cell-focus-target="true"]'
      ) ?? []
    ).filter((target) => getComputedStyle(target).display !== "none")

  const getRowTargets = (row: HTMLElement) =>
    Array.from(
      row.querySelectorAll<HTMLElement>(
        '[data-page-table-grid-cell-focus-target="true"], [data-page-table-row-actions-focus-target="true"]'
      )
    ).filter((target) => getComputedStyle(target).display !== "none")

  const focusRowColumn = (row: HTMLElement, columnIndex: number) => {
    const target = getRowTargets(row)[columnIndex]
    if (target) target.focus()
    else row.focus()
  }

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const row = target.closest<HTMLElement>('[data-project-row="true"]')
    const header = target.closest<HTMLElement>(
      '[data-page-table-header-cell-focus-target="true"]'
    )
    const rows = getRows()
    const headerTargets = getHeaderTargets()

    if (header) {
      const columnIndex = headerTargets.indexOf(header)
      if (event.key === "ArrowLeft" && columnIndex > 0) {
        event.preventDefault()
        headerTargets[columnIndex - 1]?.focus()
      } else if (
        event.key === "ArrowRight" &&
        columnIndex < headerTargets.length - 1
      ) {
        event.preventDefault()
        headerTargets[columnIndex + 1]?.focus()
      } else if (event.key === "ArrowDown" && rows[0]) {
        event.preventDefault()
        focusRowColumn(rows[0], columnIndex)
      }
      return
    }

    if (!row) return
    const rowIndex = rows.indexOf(row)
    const rowTargets = getRowTargets(row)
    const columnIndex = target === row ? -1 : rowTargets.indexOf(target)

    if (event.key === "Escape" && target !== row) {
      event.preventDefault()
      row.focus()
    } else if (event.key === "ArrowRight") {
      const nextTarget = rowTargets[columnIndex + 1]
      if (nextTarget) {
        event.preventDefault()
        nextTarget.focus()
      }
    } else if (event.key === "ArrowLeft" && columnIndex >= 0) {
      event.preventDefault()
      if (columnIndex === 0) row.focus()
      else rowTargets[columnIndex - 1]?.focus()
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      if (rowIndex === 0) {
        if (columnIndex < 0) headerTargets[0]?.focus()
        else headerTargets[columnIndex]?.focus()
      } else if (columnIndex < 0) rows[rowIndex - 1]?.focus()
      else focusRowColumn(rows[rowIndex - 1], columnIndex)
    } else if (event.key === "ArrowDown") {
      const nextRow = rows[rowIndex + 1]
      if (!nextRow) return
      event.preventDefault()
      if (columnIndex < 0) nextRow.focus()
      else focusRowColumn(nextRow, columnIndex)
    } else if (event.key === "Home") {
      event.preventDefault()
      if (columnIndex < 0) rows[0]?.focus()
      else if (rows[0]) focusRowColumn(rows[0], columnIndex)
    } else if (event.key === "End") {
      event.preventDefault()
      const lastRow = rows.at(-1)
      if (!lastRow) return
      if (columnIndex < 0) lastRow.focus()
      else focusRowColumn(lastRow, columnIndex)
    } else if (event.key === "F10" || event.key === "ContextMenu") {
      event.preventDefault()
      const menuTrigger = row.querySelector<HTMLButtonElement>(
        '[data-project-menu-trigger="true"]'
      )
      menuTrigger?.focus()
      menuTrigger?.click()
    }
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
        <div
          role="columnheader"
          tabIndex={-1}
          data-page-table-header-focus-target="true"
          data-page-table-header-cell-focus-target="true"
          className="outline-none"
        >
          Name
        </div>
        <div
          role="columnheader"
          tabIndex={-1}
          data-page-table-header-focus-target="true"
          data-page-table-header-cell-focus-target="true"
          className="hidden text-start outline-none sm:block"
        >
          Modified
        </div>
        <div
          role="columnheader"
          tabIndex={-1}
          data-page-table-header-focus-target="true"
          data-page-table-header-cell-focus-target="true"
          className="justify-self-end outline-none"
        >
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
            onTogglePinned={() => onTogglePinned(project)}
            isPinPending={isPinPending(project._id)}
          />
        ))}
      </div>
    </div>
  )
}
