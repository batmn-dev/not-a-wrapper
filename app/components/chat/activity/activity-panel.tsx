"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { Markdown } from "@/components/ui/markdown"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { SourceUrlUIPart, ToolUIPart } from "ai"
import { createPortal } from "react-dom"
import type { ReasoningPhase } from "../use-reasoning-phase"
import { useActivityPanelDockSlot } from "./activity-panel-host"
import { ActivityStep, ActivityTimeline, StepTitle } from "./activity-timeline"
import { ContentSheetShell } from "./content-sheet-shell"
import { DockedFlyoutShell } from "./docked-flyout-shell"
import { PanelSectionHeading } from "./panel-section-heading"
import { SourcesGallery } from "./sources-gallery"

const LG_BREAKPOINT = 1024

export type ActivityPanelProps = {
  panelId?: string
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

/**
 * The shared panel body — the model's reasoning (rendered as markdown inside a
 * timeline step) plus the sources gallery. Tool invocations stay inline in the
 * assistant message (ToolInvocation), so the panel does not re-render tool steps
 * (plan §5 commit 5 scope). Rendered into the ACTIVE shell only, so favicons
 * load once (`<img>` count == N, not 2N — GA §7 R6).
 */
function PanelBody({
  sources,
  reasoningText,
  isOpaqueReasoning,
}: {
  sources: SourceUrlUIPart[]
  reasoningText: string
  isOpaqueReasoning: boolean
}) {
  const gallerySources = sources.map((source) => ({
    href: source.url,
    title: source.title ?? source.url,
  }))
  const hasVisibleReasoning = reasoningText.trim().length > 0
  const hasReasoning = hasVisibleReasoning || isOpaqueReasoning

  return (
    <div className="space-y-4">
      {hasReasoning ? (
        <div className="animate-show px-3 pt-2 pb-2 motion-reduce:animate-none">
          <PanelSectionHeading title="Pro thinking" />
          <ActivityTimeline className="mt-3 flex flex-col">
            <ActivityStep leading="done" body="description">
              <StepTitle>Reasoning</StepTitle>
              {hasVisibleReasoning ? (
                <Markdown>{reasoningText}</Markdown>
              ) : null}
            </ActivityStep>
          </ActivityTimeline>
        </div>
      ) : null}
      {gallerySources.length > 0 ? (
        <SourcesGallery
          sources={gallerySources}
          className="animate-show motion-reduce:animate-none"
        />
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
  panelId,
  open,
  onOpenChange,
  title = "Activity",
  durationSeconds,
  sources,
  reasoningText,
  isOpaqueReasoning,
}: ActivityPanelProps) {
  const isBelowLg = useBreakpoint(LG_BREAKPOINT)
  const slotElement = useActivityPanelDockSlot()
  const close = () => onOpenChange(false)

  const body = (
    <PanelBody
      sources={sources}
      reasoningText={reasoningText}
      isOpaqueReasoning={isOpaqueReasoning}
    />
  )

  // Exactly one shell is active. Mutually exclusive on the lg boundary, so the
  // body element below is mounted in at most one place.
  const dockedActive = open && !isBelowLg
  const sheetActive = isBelowLg

  return (
    <>
      {dockedActive && slotElement
        ? createPortal(
            <DockedFlyoutShell
              id={panelId}
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
          panelId={panelId}
          open={open}
          onOpenChange={onOpenChange}
          title={title}
          durationSeconds={durationSeconds}
        >
          <ScrollArea
            role="region"
            aria-label="Activity details"
            className="min-h-0 flex-1"
          >
            <div className="px-6 pb-4">{body}</div>
          </ScrollArea>
        </ContentSheetShell>
      ) : null}
    </>
  )
}
