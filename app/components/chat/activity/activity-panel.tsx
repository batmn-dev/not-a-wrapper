"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { Markdown } from "@/components/ui/markdown"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { SourceUrlUIPart, ToolUIPart } from "ai"
import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import type { ReasoningPhase } from "../use-reasoning-phase"
import { useActivityPanelDockSlot } from "./activity-panel-host"
import { useActivityPanelSectionTarget } from "./activity-panel-store"
import { ActivityStep, ActivityTimeline, StepTitle } from "./activity-timeline"
import { ContentSheetShell } from "./content-sheet-shell"
import { DockedFlyoutShell } from "./docked-flyout-shell"
import { PanelSectionHeading } from "./panel-section-heading"
import { SourcesGallery } from "./sources-gallery"
import { useDockedPanelCollapse } from "./use-docked-panel-collapse"

// `lg` (1024px / 64rem) — the docked↔sheet boundary. This is a VIEWPORT media
// query (useBreakpoint → matchMedia on innerWidth) that gates whether the panel
// mounts as the docked flyout (≥lg) or the sheet (<lg), matching ChatGPT's
// `max-lg:w-0!`. It coincides numerically with the thread's cap tier
// (`@[64rem]/main`; see THREAD_MAXWIDTH_VARS in ./thread-bounds) but is a
// DIFFERENT query axis — VIEWPORT width here vs the `@container/main` width
// there. They no longer interact during the panel animation: `layout-app` scopes
// `@container/main` to span the dock slot, so opening the panel can't drive the
// container across the cap tier (the close reflows continuously, no re-cap).
const LG_BREAKPOINT = 1024

/**
 * ActivityPanel props.
 *
 * NOTE — intentional scaffolding (do not "clean up" as dead): `phase`, `steps`,
 * and `isReasoningStreaming` are mirrored from the ChatGPT activity panel and
 * carried through `panelProps` for an upcoming pass that renders a live,
 * multi-step reasoning timeline. The component does not read them yet. See
 * TODO.md ("Chat side panel"). Reference grounding (reference-ui/ChatGPT):
 *   • `steps` + the timeline globe/bullet/done markers — SUPPORTED (the capture
 *     shows 40 distinct steps with per-type markers and chip/description bodies).
 *   • `isReasoningStreaming` — PARTIAL (the `animate-show` enter + a reserved
 *     empty chip-row slot are real; live token-by-token typing was not captured).
 *   • `phase` ("thinking" | "complete") — NOT-FOUND in the captures (settled
 *     end-state only); speculative — re-verify against a live "still thinking"
 *     capture before wiring.
 */
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
    sourceId: source.sourceId,
    href: source.url,
    title: source.title ?? source.url,
  }))
  const hasVisibleReasoning = reasoningText.trim().length > 0
  const hasReasoning = hasVisibleReasoning || isOpaqueReasoning

  // One-shot section target from the store (the sources badge opens the panel
  // "on the Sources section"). Runs after the commit that projected the target
  // turn, so the gallery below is this turn's; scrollIntoView reaches whichever
  // shell's scroll viewport hosts the body. Consumed even when the projected
  // turn has no sources so a stale target can't fire on a later open.
  const { section, consume } = useActivityPanelSectionTarget()
  const sourcesSectionRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (section !== "sources") return
    sourcesSectionRef.current?.scrollIntoView({ block: "start" })
    consume()
  }, [section, consume])

  return (
    <div className="space-y-4">
      {hasReasoning ? (
        <div className="px-3 pt-2 pb-2">
          <PanelSectionHeading title="Thinking" />
          <ActivityTimeline className="mt-3 flex flex-col">
            <ActivityStep leading="done" body="description">
              <StepTitle>Reasoning</StepTitle>
              {hasVisibleReasoning ? (
                <Markdown className="text-muted-foreground text-sm leading-5">
                  {reasoningText}
                </Markdown>
              ) : null}
            </ActivityStep>
          </ActivityTimeline>
        </div>
      ) : null}
      {gallerySources.length > 0 ? (
        <div ref={sourcesSectionRef} className="scroll-mt-3">
          <SourcesGallery sources={gallerySources} />
        </div>
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

  // The docked flyout owns >=lg; the Sheet owns <lg. They stay mutually exclusive
  // on the lg boundary, so the body element below is mounted in at most one place
  // (favicons load once — GA §7 R6).
  const dockedExpanded = open && !isBelowLg
  const sheetActive = isBelowLg

  // The deferred-unmount / close-collapse lifecycle lives in this hook so the
  // component stays focused on shell composition. The layout slot owns the
  // width transition and stays mounted (populated) until its `transitionend`.
  const { dockedPresent, onDockedContentRef } = useDockedPanelCollapse({
    slotElement,
    dockedExpanded,
    isBelowLg,
  })

  return (
    <>
      {dockedPresent && slotElement
        ? createPortal(
            <div
              ref={onDockedContentRef}
              className="absolute h-full w-[var(--activity-panel-width)]"
            >
              <DockedFlyoutShell
                panelId={panelId}
                title={title}
                durationSeconds={durationSeconds}
                active={dockedExpanded}
                onClose={close}
              >
                {body}
              </DockedFlyoutShell>
            </div>,
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
