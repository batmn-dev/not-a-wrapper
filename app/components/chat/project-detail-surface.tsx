"use client"

import { HeaderSidebarTrigger } from "@/app/components/layout/header-sidebar-trigger"
import { ProjectActionsMenu } from "@/app/components/projects/project-actions-menu"
import { useProjectPinning } from "@/app/components/projects/use-project-pinning"
import { useRenameProject } from "@/app/components/projects/use-rename-project"
import { Icon } from "@/components/ui/icon"
import { InlineRenameInput } from "@/components/ui/inline-rename-input"
import type { Id } from "@/convex/_generated/dataModel"
import { useInlineRename } from "@/hooks/use-inline-rename"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { RiArrowDownSLine, RiFolderLine, RiMoreFill } from "@remixicon/react"
import { useState } from "react"

type ProjectDetailSurfaceProps = {
  project: {
    id: Id<"projects">
    name: string
    pinned?: boolean
  }
  onStartChat: () => void
}

const projectActionsTriggerClassName =
  "text-[var(--text-primary)] hover:bg-interactive-hover focus-visible:ring-border-strong flex size-9 shrink-0 items-center justify-center rounded-full border border-border-strong bg-background text-sm/5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-2"

// The project-onboarding surface's HEADER region only: the mobile compact
// header and the desktop title block. The composer chrome and the chat
// directory are composed around a stable composer slot by Chat
// (chat.tsx) — the composer must NOT live inside this component, or the
// onboarding→thread flip would remount it mid-send and drop its attachment
// previews, display text, and focus.
export function ProjectDetailSurface({
  project,
  onStartChat,
}: ProjectDetailSurfaceProps) {
  const [projectName, setProjectName] = useState(project.name)
  const renameProject = useRenameProject()
  const { preferences } = useUserPreferences()
  const hasSidebar = preferences.layout === "sidebar"
  const { isPinned, isPinPending, togglePinned } = useProjectPinning()
  const pinnableProject = { _id: project.id, pinned: project.pinned }
  const pinned = isPinned(pinnableProject)

  const saveProjectName = async (nextName: string) => {
    const previousName = projectName
    setProjectName(nextName)
    try {
      await renameProject(project.id, nextName)
    } catch (error) {
      setProjectName(previousName)
      throw error
    }
  }
  const {
    isEditing: isDesktopEditing,
    start: startDesktopEditing,
    containerRef: desktopRenameContainerRef,
    inputProps: desktopRenameInputProps,
    onContainerClick: onDesktopRenameContainerClick,
  } = useInlineRename(projectName, saveProjectName)
  const {
    isEditing: isMobileEditing,
    start: startMobileEditing,
    containerRef: mobileRenameContainerRef,
    inputProps: mobileRenameInputProps,
    onContainerClick: onMobileRenameContainerClick,
  } = useInlineRename(projectName, saveProjectName)

  const actionProject = {
    _id: project.id,
    name: projectName,
    pinned,
  }

  const desktopActionsTrigger = (
    <button
      type="button"
      className={projectActionsTriggerClassName}
      aria-label={`Open project actions for ${projectName}`}
    >
      <Icon icon={RiMoreFill} slotSize={20} />
    </button>
  )

  const mobileActionsTrigger = (
    <button
      type="button"
      className="hover:bg-interactive-hover focus-visible:ring-border-strong flex size-9 items-center justify-center rounded-lg text-[var(--text-primary)] outline-none focus-visible:ring-2"
      aria-label={`Show project details for ${projectName}`}
    >
      <Icon icon={RiMoreFill} slotSize={20} />
    </button>
  )

  return (
    <>
      <header className="bg-background h-app-header sticky top-0 z-30 flex shrink-0 items-center justify-between gap-2 px-2 [box-shadow:var(--sharp-edge-top-shadow-placeholder)] md:hidden">
        <div className="flex min-w-0 flex-1 items-center">
          <div className="relative flex shrink-0">
            {hasSidebar ? <HeaderSidebarTrigger /> : null}
          </div>
        </div>
        <div className="pointer-events-none absolute start-1/2 flex max-w-[calc(100%-8rem)] -translate-x-1/2 flex-col items-center">
          {isMobileEditing ? (
            <div
              ref={mobileRenameContainerRef}
              onClick={onMobileRenameContainerClick}
              className="pointer-events-auto flex min-h-6 max-w-full min-w-0 items-center text-[17px]/[22px] font-medium text-[var(--text-primary)]"
            >
              <InlineRenameInput
                {...mobileRenameInputProps}
                aria-label="Project title"
                className="w-full text-center"
              />
            </div>
          ) : (
            <div className="flex min-h-6 max-w-full items-center truncate text-[17px]/[22px] font-medium text-[var(--text-primary)]">
              {projectName}
            </div>
          )}
          <button
            type="button"
            onClick={onStartChat}
            className="pointer-events-auto flex h-7 items-center justify-center gap-0.5 rounded-full px-2.5 text-[13px]/[18px] font-normal whitespace-nowrap text-[var(--text-tertiary)] outline-none hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]"
          >
            Chat
            <Icon
              icon={RiArrowDownSLine}
              slotSize={18}
              className="text-[var(--text-tertiary)]"
            />
          </button>
        </div>
        <div className="flex shrink-0 items-center justify-center pe-2">
          <ProjectActionsMenu
            project={actionProject}
            onStartEditing={startMobileEditing}
            onTogglePinned={() => void togglePinned(pinnableProject)}
            isPinned={pinned}
            isPinPending={isPinPending(project.id)}
            trigger={mobileActionsTrigger}
            triggerAriaLabel={`Show project details for ${projectName}`}
            contentAlign="end"
          />
        </div>
      </header>

      <div className="mx-auto hidden w-full max-w-(--project-detail-outer-width) px-6 pt-10 md:block md:max-lg:px-4">
        <div className="mt-9 flex min-h-19 items-end gap-4">
          <div className="flex min-h-9 min-w-0 flex-1 items-start gap-1.5">
            <div className="flex size-9 shrink-0 items-center justify-center">
              <Icon
                icon={RiFolderLine}
                slotSize={32}
                glyphInset={0}
                data-testid="project-folder-icon"
                className="text-[var(--text-primary)]"
              />
            </div>
            {isDesktopEditing ? (
              <div
                ref={desktopRenameContainerRef}
                onClick={onDesktopRenameContainerClick}
                className="text-heading-app flex min-w-0 flex-1 items-center text-[var(--text-primary)]"
              >
                <InlineRenameInput
                  {...desktopRenameInputProps}
                  aria-label="Project title"
                  className="w-full"
                />
              </div>
            ) : (
              <h1 className="text-heading-app min-w-0 flex-1 truncate text-[var(--text-primary)] md:flex md:h-9 md:items-center">
                <button
                  type="button"
                  onClick={startDesktopEditing}
                  className="focus-visible:ring-border-strong max-w-full truncate text-start outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  aria-label={`Edit the title of ${projectName}`}
                >
                  {projectName}
                </button>
              </h1>
            )}
          </div>
          <ProjectActionsMenu
            project={actionProject}
            onStartEditing={startDesktopEditing}
            onTogglePinned={() => void togglePinned(pinnableProject)}
            isPinned={pinned}
            isPinPending={isPinPending(project.id)}
            trigger={desktopActionsTrigger}
            triggerAriaLabel={`Open project actions for ${projectName}`}
            contentAlign="end"
          />
        </div>
      </div>
    </>
  )
}
