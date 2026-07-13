"use client"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useRef, type ReactNode, type Ref } from "react"
import { PanelHeader } from "./panel-header"

export type DockedFlyoutShellProps = {
  panelId?: string
  title: string
  durationSeconds?: number
  active: boolean
  onClose: () => void
  children: ReactNode
  viewportRef?: Ref<HTMLDivElement>
  className?: string
}

/**
 * In-flow landmark rather than a dialog: no backdrop, focus trap, or scroll
 * lock. Its fixed width is clipped by the animating dock slot so content never
 * reflows during open/close.
 */
export function DockedFlyoutShell({
  panelId,
  title,
  durationSeconds,
  active,
  onClose,
  children,
  viewportRef,
  className,
}: DockedFlyoutShellProps) {
  const internalViewportRef = useRef<HTMLDivElement>(null)
  const scrollViewportRef = viewportRef ?? internalViewportRef

  return (
    <section
      id={panelId}
      data-testid="screen-threadFlyOut"
      aria-label="Reasoning details"
      aria-hidden={active ? undefined : true}
      inert={active ? undefined : true}
      className={cn(
        "text-foreground border-foreground/5 flex h-full w-[var(--activity-panel-width)] flex-col border-s bg-[var(--activity-panel-surface)]",
        className
      )}
    >
      <PanelHeader
        title={title}
        durationSeconds={durationSeconds}
        onClose={onClose}
      />
      <ScrollArea viewportRef={scrollViewportRef} className="min-h-0 flex-1">
        <div className="px-2 py-3">{children}</div>
        {/* Desktop reference uses scroll margin instead of visible tail padding. */}
        <div aria-hidden className="scroll-mb-4" />
      </ScrollArea>
    </section>
  )
}
