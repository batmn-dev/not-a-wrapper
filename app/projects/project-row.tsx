"use client"

import { ProjectActionsMenu } from "@/app/components/projects/project-actions-menu"
import { useRenameProject } from "@/app/components/projects/use-rename-project"
import { Icon } from "@/components/ui/icon"
import { InlineRenameInput } from "@/components/ui/inline-rename-input"
import { useInlineRename } from "@/hooks/use-inline-rename"
import { useChats } from "@/lib/chat-store/chats/provider"
import { cn } from "@/lib/utils"
import { RiAddLine, RiMoreFill, RiPushpin2Fill } from "@remixicon/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState, type KeyboardEvent } from "react"
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
  // Pill radius is the captured 16px (ChatGPT --radius-2xl), which no local
  // radius token hits (our 2xl computes 18px).
  "before:bg-row-hover before:pointer-events-none before:absolute before:-inset-x-4 before:-inset-y-px before:z-0 before:rounded-[1rem] before:opacity-0 before:transition-opacity before:duration-150 motion-reduce:before:transition-none",
  "hover:z-[1] hover:before:opacity-100",
  "after:border-foreground after:pointer-events-none after:absolute after:-inset-x-4 after:-inset-y-px after:z-[1] after:rounded-[1rem] after:border-2 after:opacity-0",
  "focus-visible:z-[3] focus-visible:outline-none focus-visible:before:opacity-100 focus-visible:after:opacity-100"
)

type ProjectRowProps = {
  project: DirectoryProject
  tabIndex: 0 | -1
  onRowFocus: () => void
  onTogglePinned: () => void
  isPinPending: boolean
}

/**
 * One directory row: the whole resting row is the project's `/p/[projectId]`
 * link (the app's single-anchor recipe), with the icon tile, name, compact
 * modified date, and the hover/focus-revealed actions menu nested inside.
 * Rename swaps the anchor for an inline editor, sharing `useInlineRename` and
 * the rename mutation path with the sidebar row.
 */
export function ProjectRow({
  project,
  tabIndex,
  onRowFocus,
  onTogglePinned,
  isPinPending,
}: ProjectRowProps) {
  const router = useRouter()
  const { createNewChat } = useChats()
  const renameProject = useRenameProject()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isCreatingChat, setIsCreatingChat] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)

  const { isEditing, start, containerRef, inputProps, onContainerClick } =
    useInlineRename(project.name || "", (next) =>
      renameProject(project._id, next)
    )

  const displayName = project.name || "Untitled Project"
  const modifiedLabel = formatModifiedDate(project._creationTime)

  const navigateToProject = () => router.push(`/p/${project._id}`)

  const handleRowKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    navigateToProject()
  }

  const handleCreateChat = async () => {
    if (isCreatingChat) return
    setIsCreatingChat(true)
    try {
      const newChat = await createNewChat({ projectId: project._id })
      if (newChat) router.push(`/c/${newChat.id}`)
    } finally {
      setIsCreatingChat(false)
    }
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
      {isEditing ? (
        <InlineRenameInput
          {...inputProps}
          aria-label="Project title"
          className="text-foreground w-full text-sm/[18px]"
        />
      ) : (
        <div className="flex min-w-0 flex-col">
          <div className="text-foreground flex min-w-0 items-center gap-1.5 text-sm/[18px]">
            <span className="min-w-0 truncate">{displayName}</span>
            {project.pinned ? (
              <span
                className="shrink-0 text-[var(--text-tertiary)]"
                title="Pinned"
              >
                <Icon icon={RiPushpin2Fill} slotSize={14} />
                <span className="sr-only">Pinned</span>
              </span>
            ) : null}
          </div>
          {/* Mobile-only stacked date (12/16, secondary). */}
          <div className="text-muted-foreground mt-1 truncate text-xs/4 sm:hidden">
            {modifiedLabel}
          </div>
        </div>
      )}
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
      <div className="relative h-9 w-[78px] shrink-0">
        {/* Desktop reveal on row hover / focus-within; always visible on touch;
            pinned visible while the menu is open (focus moves into the popup,
            so focus-within alone would hide the open menu's trigger). */}
        <div
          data-testid="project-row-actions"
          data-menu-open={isMenuOpen || undefined}
          className={cn(
            "absolute inset-y-0 end-0 flex items-center justify-end gap-1.5 transition-opacity duration-150 motion-reduce:transition-none",
            "pointer-events-none opacity-0",
            "group-hover/project-row:pointer-events-auto group-hover/project-row:opacity-100",
            "group-focus-within/project-row:pointer-events-auto group-focus-within/project-row:opacity-100",
            "pointer-coarse:pointer-events-auto pointer-coarse:opacity-100",
            isMenuOpen && "pointer-events-auto opacity-100"
          )}
        >
          <button
            type="button"
            tabIndex={-1}
            data-project-row-action="true"
            data-project-new-chat="true"
            aria-label={`New chat in ${displayName}`}
            disabled={isCreatingChat}
            aria-busy={isCreatingChat || undefined}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void handleCreateChat()
            }}
            className="hover:bg-muted data-[creating=true]:bg-muted focus-visible:ring-focus-ring flex size-9 min-h-9 items-center justify-center rounded-sm text-[var(--text-tertiary)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
            data-creating={isCreatingChat || undefined}
          >
            <Icon icon={RiAddLine} slotSize={20} />
          </button>
          <ProjectActionsMenu
            project={project}
            onStartEditing={start}
            onTogglePinned={onTogglePinned}
            isPinned={Boolean(project.pinned)}
            isPinPending={isPinPending}
            onMenuOpenChange={(open) => {
              setIsMenuOpen(open)
              if (!open) {
                requestAnimationFrame(() => {
                  menuTriggerRef.current
                    ?.closest<HTMLElement>('[data-project-row="true"]')
                    ?.focus()
                })
              }
            }}
            triggerAriaLabel={`Open project options for ${displayName}`}
            contentAlign="end"
            trigger={
              <button
                ref={menuTriggerRef}
                type="button"
                tabIndex={-1}
                data-project-row-action="true"
                data-project-menu-trigger="true"
                data-page-table-grid-focus-target="true"
                data-page-table-row-actions-focus-target="true"
                aria-label={`Open project options for ${displayName}`}
                // Nested inside the row <Link>: cancel the anchor's navigation
                // and keep the click off the row before the menu toggles.
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                className="hover:bg-muted data-popup-open:bg-muted focus-visible:ring-focus-ring flex size-9 min-h-9 items-center justify-center rounded-sm text-[var(--text-tertiary)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none"
              >
                <Icon icon={RiMoreFill} slotSize={20} />
              </button>
            }
          />
        </div>
      </div>
    </div>
  )

  // Rename mode keeps a plain container (click-outside commits; no navigation).
  if (isEditing) {
    return (
      <div
        role="row"
        tabIndex={-1}
        data-project-row="true"
        data-project-id={project._id}
        ref={containerRef}
        onClick={onContainerClick}
        className={cn(rowShellClassName, "z-[1] before:opacity-100")}
      >
        {nameCell}
        {modifiedCell}
        {actionsCell}
      </div>
    )
  }

  return (
    <Link
      role="row"
      tabIndex={tabIndex}
      data-project-row="true"
      data-project-id={project._id}
      data-page-table-selectable-row="true"
      aria-selected="false"
      href={`/p/${project._id}`}
      prefetch
      draggable={false}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onRowFocus()
      }}
      onKeyDown={handleRowKeyDown}
      className={cn(
        rowShellClassName,
        isMenuOpen && "z-[1] before:opacity-100"
      )}
    >
      {nameCell}
      {modifiedCell}
      {actionsCell}
    </Link>
  )
}
