"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import { Markdown } from "@/components/ui/markdown"
import { ScrollArea } from "@/components/ui/scroll-area"
import type {
  AssistantActivitySection,
  AssistantActivityToolEntry,
} from "@/lib/chat-messages/assistant-activity"
import { useRef } from "react"
import { createPortal } from "react-dom"
import { useActivityPanelDockSlot } from "./activity-panel-host"
import { useActivityPanelSectionTarget } from "./activity-panel-store"
import { ActivityStep, ActivityTimeline, StepTitle } from "./activity-timeline"
import { ContentSheetShell } from "./content-sheet-shell"
import { DockedFlyoutShell } from "./docked-flyout-shell"
import { PanelSectionHeading } from "./panel-section-heading"
import { SourcesGallery } from "./sources-gallery"
import { useDockedPanelCollapse } from "./use-docked-panel-collapse"

const LG_BREAKPOINT = 1024

export type ActivityPanelProps = {
  panelId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  durationSeconds?: number
  sections: readonly AssistantActivitySection[]
}

function ToolSection({
  heading,
  entries,
}: {
  heading: string
  entries: readonly AssistantActivityToolEntry[]
}) {
  return (
    <div className="px-3 pt-2 pb-2">
      <PanelSectionHeading title={heading} />
      <ActivityTimeline className="mt-3 flex flex-col">
        {entries.map((entry) => (
          <ActivityStep key={entry.id} leading="done" body="description">
            <StepTitle>{entry.label}</StepTitle>
            <p className="text-muted-foreground text-sm leading-5">
              {entry.description}
            </p>
          </ActivityStep>
        ))}
      </ActivityTimeline>
    </div>
  )
}

function PanelBody({
  sections,
}: {
  sections: readonly AssistantActivitySection[]
}) {
  const { section, consume } = useActivityPanelSectionTarget()
  const sourcesSectionRef = useRef<HTMLDivElement>(null)
  useBrowserLayoutEffect(() => {
    if (section !== "sources") return
    sourcesSectionRef.current?.scrollIntoView({ block: "start" })
    consume()
  }, [section, consume])

  return (
    <div className="space-y-4">
      {sections.map((activitySection) => {
        switch (activitySection.kind) {
          case "reasoning":
            return (
              <div key="reasoning" className="px-3 pt-2 pb-2">
                <PanelSectionHeading title="Thinking" />
                <ActivityTimeline className="mt-3 flex flex-col">
                  {activitySection.blocks.map((block, index) => (
                    <ActivityStep
                      key={index}
                      leading={activitySection.isStreaming ? "bullet" : "done"}
                      body="description"
                    >
                      <StepTitle>Reasoning</StepTitle>
                      <Markdown className="text-muted-foreground text-sm leading-5">
                        {block.text}
                      </Markdown>
                    </ActivityStep>
                  ))}
                </ActivityTimeline>
              </div>
            )
          case "sources": {
            const sources = activitySection.sources.map((source) => ({
              sourceId: source.sourceId,
              href: source.url,
              title: source.title ?? source.url,
            }))
            return (
              <div
                key="sources"
                ref={sourcesSectionRef}
                className="scroll-mt-3"
              >
                <SourcesGallery sources={sources} />
              </div>
            )
          }
          case "images":
            return (
              <div key="images" className="px-3 pt-2 pb-2">
                <PanelSectionHeading title="Images" />
                <ul className="mt-3 space-y-2">
                  {activitySection.results.map((result) => (
                    <li key={`${result.imageUrl}:${result.sourceUrl}`}>
                      <a
                        className="text-foreground text-sm underline-offset-4 hover:underline"
                        href={result.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {result.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )
          case "approvals":
            return (
              <ToolSection
                key="approvals"
                heading="Approvals"
                entries={activitySection.entries}
              />
            )
          case "tool-errors":
            return (
              <ToolSection
                key="tool-errors"
                heading="Errors"
                entries={activitySection.entries}
              />
            )
          case "tool-steps":
            return (
              <ToolSection
                key="tool-steps"
                heading="Activity"
                entries={activitySection.entries}
              />
            )
        }
      })}
    </div>
  )
}

export function ActivityPanel({
  panelId,
  open,
  onOpenChange,
  title = "Activity",
  durationSeconds,
  sections,
}: ActivityPanelProps) {
  const isBelowLg = useBreakpoint(LG_BREAKPOINT)
  const slotElement = useActivityPanelDockSlot()
  const close = () => onOpenChange(false)
  const body = <PanelBody sections={sections} />
  const dockedExpanded = open && !isBelowLg
  const sheetActive = isBelowLg
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
