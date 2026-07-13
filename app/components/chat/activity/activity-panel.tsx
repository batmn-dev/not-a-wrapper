"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import { Icon } from "@/components/ui/icon"
import { Markdown } from "@/components/ui/markdown"
import { ScrollArea } from "@/components/ui/scroll-area"
import type {
  ActivityEntryStatus,
  AssistantActivityEntry,
  AssistantActivityModel,
} from "@/lib/chat-messages/assistant-activity"
import { parseSafeExternalUrl } from "@/lib/url-safety"
import { RiCheckLine, RiCodeLine, RiFileCopyLine } from "@remixicon/react"
import { useId, useRef, useState } from "react"
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
const VISIBLE_SOURCE_CHIPS = 3

type ToolApprovalHandler = (
  approvalId: string,
  approved: boolean,
  reason?: string
) => Promise<void> | void

export type ActivityPanelProps = {
  panelId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  durationSeconds?: number
  activity?: AssistantActivityModel
  onToolApproval?: ToolApprovalHandler
}

function ActivityToolCard({
  entry,
  onToolApproval,
}: {
  entry: AssistantActivityEntry
  onToolApproval?: ToolApprovalHandler
}) {
  const [copied, setCopied] = useState(false)
  const code = entry.tool?.code
  const approvalId = entry.tool?.approvalId
  const copy = () => {
    if (!code) return
    void navigator.clipboard?.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  return (
    <div className="bg-muted border-foreground/5 mt-3 overflow-hidden rounded-[24px] border">
      <div className="flex h-12 items-center gap-2 px-4">
        <Icon icon={RiCodeLine} slotSize={16} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {entry.tool?.displayName ?? entry.title}
        </span>
        {code ? (
          <button
            type="button"
            aria-label={copied ? "Copied" : "Copy"}
            onClick={copy}
            className="hover:bg-foreground/[0.07] focus-visible:ring-ring inline-flex size-9 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2"
          >
            <Icon icon={copied ? RiCheckLine : RiFileCopyLine} slotSize={18} />
          </button>
        ) : null}
      </div>
      {code ? (
        <pre className="overflow-x-auto rounded-[6px] px-5 pb-3 text-[12.25px] leading-5">
          <code>{code}</code>
        </pre>
      ) : null}
      {approvalId ? (
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          <button
            type="button"
            disabled={!onToolApproval}
            onClick={() => void onToolApproval?.(approvalId, true)}
            className="bg-foreground text-background h-8 rounded-full px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={!onToolApproval}
            onClick={() =>
              void onToolApproval?.(approvalId, false, "Denied by user")
            }
            className="hover:bg-foreground/[0.07] h-8 rounded-full px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            Deny
          </button>
        </div>
      ) : null}
    </div>
  )
}

function sourceDomain(url: string): string {
  return parseSafeExternalUrl(url)?.hostname ?? url
}

function SearchSourceChips({ entry }: { entry: AssistantActivityEntry }) {
  const [expanded, setExpanded] = useState(false)
  const chipGroupId = useId()
  const sources = entry.sources ?? []
  if (sources.length === 0) return null
  const visible = expanded ? sources : sources.slice(0, VISIBLE_SOURCE_CHIPS)
  const remaining = sources.length - visible.length

  return (
    <div
      role="group"
      aria-label={`Sources for ${entry.title}`}
      className="mt-1.5 flex flex-wrap gap-1"
    >
      <span id={chipGroupId} className="contents">
        {visible.map((source) => {
          const safeUrl = parseSafeExternalUrl(source.url)
          const domain = sourceDomain(source.url)
          const content = (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- dynamic external favicon */}
              <img
                alt=""
                src={`https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(source.url)}`}
                className="size-3 shrink-0 rounded-full"
                width={12}
                height={12}
              />
              <span className="max-w-32 truncate">{domain}</span>
            </>
          )
          const className =
            "bg-muted text-muted-foreground inline-flex h-[25px] max-w-full items-center gap-1 overflow-hidden rounded-full px-3 text-xs"
          if (!safeUrl) {
            return (
              <span
                key={`${source.sourceId}:${source.url}`}
                className={className}
              >
                {content}
              </span>
            )
          }
          return (
            <a
              key={`${source.sourceId}:${source.url}`}
              href={safeUrl.toString()}
              target="_blank"
              rel="noopener noreferrer"
              className={`${className} hover:bg-foreground hover:text-background focus-visible:ring-ring outline-none focus-visible:ring-2`}
            >
              {content}
            </a>
          )
        })}
      </span>
      {remaining > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={chipGroupId}
          onClick={() => setExpanded(true)}
          className="bg-muted text-muted-foreground hover:bg-foreground hover:text-background focus-visible:ring-ring inline-flex h-[25px] items-center rounded-full px-3 text-xs outline-none focus-visible:ring-2"
        >
          {remaining} more
        </button>
      ) : null}
    </div>
  )
}

const STATUS_MARKERS: Record<
  Exclude<ActivityEntryStatus, "complete" | "running">,
  "approval" | "error" | "stopped"
> = {
  approval: "approval",
  error: "error",
  denied: "error",
  stopped: "stopped",
}

/** Exhaustive status/kind-to-marker mapping shared by every Activity row. */
export function activityEntryMarker(entry: AssistantActivityEntry) {
  if (entry.kind === "completion" && entry.status === "complete") {
    return "completedRun" as const
  }
  if (entry.status !== "complete" && entry.status !== "running") {
    return STATUS_MARKERS[entry.status]
  }
  switch (entry.kind) {
    case "reasoning":
      return "reasoning" as const
    case "search":
      return "search" as const
    case "tool":
      return "code" as const
    case "image":
      return "image" as const
    case "completion":
      return "bullet" as const
  }
}

function ActivityEntryRow({
  entry,
  onToolApproval,
  isLast,
  index,
}: {
  entry: AssistantActivityEntry
  onToolApproval?: ToolApprovalHandler
  isLast?: boolean
  index?: number
}) {
  return (
    <ActivityStep
      leading={activityEntryMarker(entry)}
      body="description"
      isLast={isLast}
      index={index}
    >
      <StepTitle>{entry.title}</StepTitle>
      {entry.detail ? (
        entry.kind === "reasoning" ? (
          <Markdown className="text-muted-foreground text-sm leading-5">
            {entry.detail}
          </Markdown>
        ) : (
          <p className="text-muted-foreground text-sm leading-5">
            {entry.detail}
          </p>
        )
      ) : null}
      {entry.kind === "search" ? <SearchSourceChips entry={entry} /> : null}
      {entry.kind === "tool" && entry.tool ? (
        <ActivityToolCard entry={entry} onToolApproval={onToolApproval} />
      ) : null}
    </ActivityStep>
  )
}

function PanelBody({
  activity,
  onToolApproval,
}: {
  activity?: AssistantActivityModel
  onToolApproval?: ToolApprovalHandler
}) {
  const { section, consume } = useActivityPanelSectionTarget()
  const sourcesSectionRef = useRef<HTMLDivElement>(null)
  const scrollToSources = () =>
    sourcesSectionRef.current?.scrollIntoView({ block: "start" })
  useBrowserLayoutEffect(() => {
    if (section !== "sources") return
    scrollToSources()
    consume()
  }, [section, consume])

  if (!activity) return null
  const sources = activity.sourceResults.map((source) => ({
    sourceId: source.sourceId,
    href: source.url,
    title: source.title ?? source.url,
    description: source.description,
    siteName: source.siteName,
    faviconDomain: source.faviconDomain,
  }))

  return (
    <div>
      <div className="px-3 pt-2 pb-4">
        <PanelSectionHeading title="Thinking" className="mb-3" />
        <ActivityTimeline className="flex flex-col">
          {activity.entries.map((entry) => (
            <ActivityEntryRow
              key={entry.id}
              entry={entry}
              onToolApproval={onToolApproval}
            />
          ))}
        </ActivityTimeline>
      </div>
      {activity.imageResults.length > 0 ? (
        <div className="px-3 pt-3 pb-4">
          <PanelSectionHeading title="Images" className="mb-3" />
          <ul className="grid grid-cols-2 gap-2">
            {activity.imageResults.map((result) => (
              <li key={`${result.imageUrl}:${result.sourceUrl}`}>
                <a
                  href={result.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-visible:ring-ring block overflow-hidden rounded-xl outline-none focus-visible:ring-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- provider image result */}
                  <img
                    src={result.imageUrl}
                    alt={result.title}
                    className="aspect-square w-full object-cover"
                  />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {sources.length > 0 ? (
        <div ref={sourcesSectionRef} className="scroll-mt-3 pt-3">
          <SourcesGallery sources={sources} />
        </div>
      ) : null}
    </div>
  )
}

export function ActivityPanel({
  panelId,
  open,
  onOpenChange,
  title = "Activity",
  durationSeconds,
  activity,
  onToolApproval,
}: ActivityPanelProps) {
  const isBelowLg = useBreakpoint(LG_BREAKPOINT)
  const slotElement = useActivityPanelDockSlot()
  const close = () => onOpenChange(false)
  const body = (
    <PanelBody
      key={open ? "open" : "closed"}
      activity={activity}
      onToolApproval={onToolApproval}
    />
  )
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
