"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatDuration } from "@/components/ui/reasoning"
import { getStaticToolName } from "ai"
import type { SourceUrlUIPart, ToolUIPart } from "ai"
import { createPortal } from "react-dom"
import {
  ActivityStep,
  ActivityTimeline,
  StepTitle,
} from "./activity-timeline"
import { useActivityPanelDockSlot } from "./activity-panel-host"
import { ContentSheetShell } from "./content-sheet-shell"
import { DockedFlyoutShell } from "./docked-flyout-shell"
import { SourcesGallery } from "./sources-gallery"
import type { ReasoningPhase } from "../use-reasoning-phase"

const LG_BREAKPOINT = 1024

export type ActivityPanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  phase: ReasoningPhase["phase"]
  durationSeconds?: number
  steps: ToolUIPart[]
  sources: SourceUrlUIPart[]
  reasoningText: string
  isReasoningStreaming: boolean
  isOpaqueReasoning: boolean
}

function toolLabel(step: ToolUIPart): string {
  return getStaticToolName(step)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
}

/**
 * The shared panel body — reasoning timeline + tool steps + sources gallery.
 * Rendered into the ACTIVE shell only (favicons load once; `<img>` count == N,
 * not 2N — GA §7 R6).
 */
function PanelBody({
  steps,
  sources,
  reasoningText,
}: {
  steps: ToolUIPart[]
  sources: SourceUrlUIPart[]
  reasoningText: string
}) {
  const gallerySources = sources.map((source) => ({
    href: source.url,
    title: source.title ?? source.url,
  }))
  const hasReasoning = reasoningText.trim().length > 0
  const hasSteps = steps.length > 0

  return (
    <div className="space-y-4">
      {hasReasoning || hasSteps ? (
        <ActivityTimeline>
          {hasReasoning ? (
            <ActivityStep leading="done" body="description">
              <StepTitle>Reasoning</StepTitle>
              <div className="text-muted-foreground text-sm whitespace-pre-wrap">
                {reasoningText}
              </div>
            </ActivityStep>
          ) : null}
          {steps.map((step, index) => (
            <ActivityStep key={index} leading="globe">
              <StepTitle>{toolLabel(step)}</StepTitle>
            </ActivityStep>
          ))}
        </ActivityTimeline>
      ) : null}
      {gallerySources.length > 0 ? (
        <SourcesGallery sources={gallerySources} />
      ) : null}
    </div>
  )
}

/**
 * ActivityPanel — the responsive composition root (plan §5 commit 4, GA §B).
 * CSS/Tailwind handle visual shell styling; `useBreakpoint(1024)` gates ONLY
 * the Base UI Sheet open/portal/focus path so exactly one shell is ever truly
 * active (GA §7 R5/R6, §9 note 3):
 *  - ≥lg: the docked flyout (a landmark, no trap) portaled into the layout slot.
 *  - <lg: the Sheet-backed card/bottom-sheet (Base UI Dialog: trap, lock, ESC).
 * The shared body renders into the active shell only, so favicons load once.
 */
export function ActivityPanel({
  open,
  onOpenChange,
  title = "Activity",
  phase: _phase,
  durationSeconds,
  steps,
  sources,
  reasoningText,
  isReasoningStreaming: _isReasoningStreaming,
  isOpaqueReasoning: _isOpaqueReasoning,
}: ActivityPanelProps) {
  const isBelowLg = useBreakpoint(LG_BREAKPOINT)
  const slotElement = useActivityPanelDockSlot()
  const close = () => onOpenChange(false)

  const body = (
    <PanelBody steps={steps} sources={sources} reasoningText={reasoningText} />
  )

  // The Sheet's SheetTitle is its accessible name, so carry the duration in it.
  const sheetTitle =
    durationSeconds !== undefined
      ? `${title} · ${formatDuration(durationSeconds)}`
      : title

  // Exactly one shell is active. Mutually exclusive on the lg boundary, so the
  // body element below is mounted in at most one place.
  const dockedActive = open && !isBelowLg
  const sheetActive = isBelowLg

  return (
    <>
      {dockedActive && slotElement
        ? createPortal(
            <DockedFlyoutShell
              title={title}
              durationSeconds={durationSeconds}
              onClose={close}
            >
              {body}
            </DockedFlyoutShell>,
            slotElement
          )
        : null}
      {sheetActive ? (
        <ContentSheetShell
          open={open}
          onOpenChange={onOpenChange}
          title={sheetTitle}
        >
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-6 pb-4">{body}</div>
          </ScrollArea>
        </ContentSheetShell>
      ) : null}
    </>
  )
}
