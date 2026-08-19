"use client"

import { ProjectActionsMenu } from "@/app/components/projects/project-actions-menu"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiMoreFill, RiPushpin2Fill } from "@remixicon/react"
import { useRouter } from "next/navigation"
import { useState, type KeyboardEvent } from "react"
import { formatModifiedDate } from "./format-modified-date"
import { ProjectIcon } from "./project-icon"
import type { DirectoryProject } from "./projects-grid"
import { projectsGridColumnsClassName } from "./projects-grid-columns"

/**
 * Row box + hover/focus treatment, from the captured reference row:
 * a 44px-min grid row (14px block padding) whose hover state is an OPAQUE pill
 * (`::before`, bleeding 16px inline / 1px block so it conceals the adjacent
 * hairlines) and whose keyboard focus ring is a 2px foreground border
 * (`::after`) on the same pill. Cells sit at z-10 above both.
 */
const rowShellClassName = cn(
  projectsGridColumnsClassName,
  "group/project-row relative z-0 min-h-11 cursor-pointer items-center py-3.5 ps-0 pe-2",
  // No local radius token maps to the required 16px.
  "before:bg-row-hover before:pointer-events-none before:absolute before:-inset-x-4 before:-inset-y-px before:z-0 before:rounded-[1rem] before:opacity-0 before:transition-opacity before:duration-150 motion-reduce:before:transition-none",
  "hover:z-[1] hover:before:opacity-100",
  "after:border-foreground after:pointer-events-none after:absolute after:-inset-x-4 after:-inset-y-px after:z-[1] after:rounded-[1rem] after:border-2 after:opacity-0",
  "focus-visible:z-[3] focus-visible:outline-none focus-visible:before:opacity-100 focus-visible:after:opacity-100"
)

type ProjectRowProps = {
  project: DirectoryProject
  onTogglePinned: () => void
  isPinPending: boolean
}

/**
 * One directory row: the selectable grid row navigates to `/p/[projectId]`
 * and contains the icon tile, name, compact modified date, and the
 * hover/focus-revealed actions menu.
 */
export function ProjectRow({
  project,
  onTogglePinned,
  isPinPending,
}: ProjectRowProps) {
  const router = useRouter()
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const displayName = project.name || "Untitled Project"
  const modifiedLabel = formatModifiedDate(
    project.updatedAt ?? project._creationTime
  )

  const navigateToProject = () => router.push(`/p/${project._id}`)

  const handleRowKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    navigateToProject()
  }

  const nameCell = (
    <div
      role="gridcell"
      tabIndex={-1}
      data-page-table-grid-focus-target="true"
      data-page-table-grid-cell-focus-target="true"
      className="relative z-10 flex min-w-0 items-center gap-3 text-start"
    >
      <ProjectIcon />
      <div className="flex min-w-0 flex-col">
        <div className="text-foreground flex min-w-0 items-center gap-2 text-sm/[18px]">
          <span className="min-w-0 truncate">{displayName}</span>
        </div>
        {/* Mobile-only stacked date (12/16, secondary). */}
        <div className="text-muted-foreground mt-1 truncate text-xs/4 sm:hidden">
          {modifiedLabel}
        </div>
      </div>
    </div>
  )

  const modifiedCell = (
    <div
      role="gridcell"
      tabIndex={-1}
      data-page-table-grid-focus-target="true"
      data-page-table-grid-cell-focus-target="true"
      className="text-muted-foreground relative z-10 hidden truncate text-start text-sm/[18px] sm:block"
    >
      {modifiedLabel}
    </div>
  )

  const actionsCell = (
    <div
      role="gridcell"
      data-page-table-row-actions="true"
      className="relative z-10 -me-2 flex items-center justify-end"
    >
      <div className="relative size-9 shrink-0">
        {project.pinned ? (
          <div
            data-testid="project-row-pin"
            className={cn(
              "pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--text-tertiary)] transition-opacity duration-150 motion-reduce:transition-none",
              "opacity-100 group-hover/project-row:opacity-0 group-focus-within/project-row:opacity-0",
              "max-sm:opacity-0 pointer-coarse:opacity-0",
              isMenuOpen && "opacity-0"
            )}
            title="Pinned"
          >
            <Icon icon={RiPushpin2Fill} slotSize={16} glyphInset={0} />
            <span className="sr-only">Pinned</span>
          </div>
        ) : null}
        {/* Desktop reveal on row hover / focus-within; always visible on touch;
            pinned visible while the menu is open (focus moves into the popup,
            so focus-within alone would hide the open menu's trigger). */}
        <div
          data-testid="project-row-actions"
          data-menu-open={isMenuOpen || undefined}
          className={cn(
            "absolute inset-y-0 end-0 flex size-9 items-center justify-end transition-opacity duration-150 motion-reduce:transition-none",
            "pointer-events-none opacity-0",
            "group-hover/project-row:pointer-events-auto group-hover/project-row:opacity-100",
            "group-focus-within/project-row:pointer-events-auto group-focus-within/project-row:opacity-100",
            "max-sm:pointer-events-auto max-sm:opacity-100",
            "pointer-coarse:pointer-events-auto pointer-coarse:opacity-100",
            isMenuOpen && "pointer-events-auto opacity-100"
          )}
        >
          <ProjectActionsMenu
            project={project}
            onTogglePinned={onTogglePinned}
            isPinned={Boolean(project.pinned)}
            isPinPending={isPinPending}
            onMenuOpenChange={setIsMenuOpen}
            triggerAriaLabel={`Open project options for ${displayName}`}
            contentAlign="end"
            presentation="directory"
            trigger={
              <button
                type="button"
                tabIndex={-1}
                data-project-row-action="true"
                data-project-menu-trigger="true"
                data-page-table-grid-focus-target="true"
                data-page-table-row-actions-focus-target="true"
                aria-label={`Open project options for ${displayName}`}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                className="hover:bg-[var(--projects-control-fill)] data-popup-open:bg-[var(--projects-control-fill)] flex size-9 min-h-9 items-center justify-center rounded-sm text-[var(--text-tertiary)] transition-colors outline-none focus-visible:outline-[1.5px] focus-visible:outline-offset-[2.5px] focus-visible:outline-foreground focus-visible:[outline-style:solid] motion-reduce:transition-none"
              >
                <Icon icon={RiMoreFill} slotSize={20} />
              </button>
            }
          />
        </div>
      </div>
    </div>
  )

  return (
    <div
      role="row"
      tabIndex={0}
      data-project-row="true"
      data-project-id={project._id}
      data-page-table-selectable-row="true"
      aria-selected="false"
      onClick={navigateToProject}
      onKeyDown={handleRowKeyDown}
      className={cn(
        rowShellClassName,
        isMenuOpen && "z-[1] before:opacity-100"
      )}
    >
      {nameCell}
      {modifiedCell}
      {actionsCell}
    </div>
  )
}
