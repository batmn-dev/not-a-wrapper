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
  AssistantActivitySearchEntry,
  AssistantActivityToolEntry,
} from "@/lib/chat-messages/assistant-activity"
import { parseSafeExternalUrl } from "@/lib/url-safety"
import { RiCheckLine, RiCodeLine, RiFileCopyLine } from "@remixicon/react"
import Image from "next/image"
import { useId, useRef, useState, type RefCallback } from "react"
import { createPortal } from "react-dom"
import { useActivityPanelDockSlot } from "./activity-panel-host"
import { useActivityPanelSectionTarget } from "./activity-panel-store"
import { ActivityStep, ActivityTimeline, StepTitle } from "./activity-timeline"
import { ContentSheetShell } from "./content-sheet-shell"
import { DockedFlyoutShell } from "./docked-flyout-shell"
import { PanelSectionHeading } from "./panel-section-heading"
import { SourcesGallery } from "./sources-gallery"
import { useActivityPanelScrollFollow } from "./use-activity-panel-scroll-follow"
import { useDockedPanelCollapse } from "./use-docked-panel-collapse"

const LG_BREAKPOINT = 1024
const VISIBLE_SOURCE_CHIPS = 3
const ACTIVITY_PANEL_RAISED_STYLE = {
  backgroundColor: "var(--activity-panel-raised-surface)",
} as const

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
  turnKey?: string
  followLatest?: boolean
}

function ActivityToolCard({
  entry,
  onToolApproval,
}: {
  entry: AssistantActivityToolEntry
  onToolApproval?: ToolApprovalHandler
}) {
  const [copied, setCopied] = useState(false)
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false)
  const isSubmittingApprovalRef = useRef(false)
  const code = entry.tool.code
  const approvalId =
    entry.status === "approval" ? entry.tool.approvalId : undefined
  const copy = async () => {
    if (!code || !navigator.clipboard) return

    try {
      await navigator.clipboard.writeText(code)
    } catch {
      return
    }

    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }
  const submitToolApproval = async (approved: boolean, reason?: string) => {
    if (!onToolApproval || !approvalId || isSubmittingApprovalRef.current) {
      return
    }

    isSubmittingApprovalRef.current = true
    setIsSubmittingApproval(true)
    try {
      await onToolApproval(approvalId, approved, reason)
    } finally {
      isSubmittingApprovalRef.current = false
      setIsSubmittingApproval(false)
    }
  }

  return (
    <div
      className="mt-3 overflow-hidden rounded-[24px]"
      style={ACTIVITY_PANEL_RAISED_STYLE}
    >
      <div className="flex h-12 items-center gap-2 px-4">
        <Icon icon={RiCodeLine} slotSize={16} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {entry.tool.displayName}
        </span>
        {code ? (
          <button
            type="button"
            aria-label={copied ? "Copied" : "Copy"}
            onClick={copy}
            className="hover:bg-interactive-hover active:bg-interactive-pressed focus-visible:ring-focus-ring inline-flex size-9 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2"
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
            disabled={!onToolApproval || isSubmittingApproval}
            onClick={() => void submitToolApproval(true)}
            className="bg-foreground text-background h-8 rounded-full px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={!onToolApproval || isSubmittingApproval}
            onClick={() => void submitToolApproval(false, "Denied by user")}
            className="hover:bg-interactive-hover active:bg-interactive-pressed disabled:text-disabled-foreground h-8 rounded-full px-3 text-sm font-medium disabled:cursor-not-allowed"
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

function SearchSourceChips({ entry }: { entry: AssistantActivitySearchEntry }) {
  const [expanded, setExpanded] = useState(false)
  const chipGroupId = useId()
  const sources = entry.sources
  if (sources.length === 0) return null
  const visible = expanded ? sources : sources.slice(0, VISIBLE_SOURCE_CHIPS)
  const hiddenSources = sources.slice(VISIBLE_SOURCE_CHIPS)

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
              <Image
                alt=""
                src={`https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(source.url)}`}
                width={12}
                height={12}
                loading="lazy"
                decoding="async"
                className="size-3 shrink-0 rounded-full"
              />
              <span className="max-w-32 truncate">{domain}</span>
            </>
          )
          const className =
            "text-muted-foreground inline-flex h-[25px] max-w-full items-center gap-1 overflow-hidden rounded-full px-3 text-xs"
          if (!safeUrl) {
            return (
              <span
                key={`${source.sourceId}:${source.url}`}
                className={className}
                style={ACTIVITY_PANEL_RAISED_STYLE}
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
              className={`${className} hover:bg-interactive-hover! hover:text-foreground active:bg-interactive-pressed! focus-visible:ring-focus-ring outline-none focus-visible:ring-2`}
              style={ACTIVITY_PANEL_RAISED_STYLE}
            >
              {content}
            </a>
          )
        })}
      </span>
      {hiddenSources.length > 0 ? (
        // The reference overflow control is a free toggle (measured
        // 2026-07-13): collapsed, an "N more" chip leads with a stacked
        // favicon preview of the first three hidden sources; expanded, a
        // text-only "Show less" chip collapses back. ChatGPT ships neither
        // state with disclosure ARIA; we keep it.
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={chipGroupId}
          onClick={() => setExpanded((value) => !value)}
          className="group text-muted-foreground hover:bg-interactive-hover! hover:text-foreground active:bg-interactive-pressed! focus-visible:ring-focus-ring inline-flex h-[25px] max-w-full items-center gap-1 overflow-hidden rounded-full px-3 text-xs outline-none focus-visible:ring-2"
          style={ACTIVITY_PANEL_RAISED_STYLE}
        >
          {expanded ? (
            "Show less"
          ) : (
            <>
              {hiddenSources.slice(0, 3).map((source) => (
                <span
                  key={`${source.sourceId}:${source.url}`}
                  className="border-muted bg-background group-hover:border-foreground -ms-3 box-content size-3 shrink-0 overflow-hidden rounded-full border first:-ms-1"
                >
                  <Image
                    alt=""
                    src={`https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(source.url)}`}
                    width={12}
                    height={12}
                    loading="lazy"
                    decoding="async"
                    className="size-3"
                  />
                </span>
              ))}
              <span className="max-w-32 truncate">
                {hiddenSources.length} more
              </span>
            </>
          )}
        </button>
      ) : null}
    </div>
  )
}

function statusMarker(
  status: ActivityEntryStatus
): "approval" | "error" | "stopped" | undefined {
  switch (status) {
    case "approval":
      return "approval"
    case "error":
    case "denied":
      return "error"
    case "stopped":
      return "stopped"
    case "running":
    case "complete":
      return undefined
  }
}

/**
 * Exhaustive status/kind-to-marker mapping shared by every Activity row.
 * The closed entry algebra makes the invariants structural: only the
 * completion row can reach the completedRun checkmark, and a reasoning row
 * has no failure status to take a status marker from.
 */
export function activityEntryMarker(entry: AssistantActivityEntry) {
  if (entry.kind === "completion") {
    return entry.status === "complete"
      ? ("completedRun" as const)
      : entry.status === "error"
        ? ("error" as const)
        : ("stopped" as const)
  }
  switch (entry.kind) {
    case "reasoning":
      return "reasoning" as const
    case "search":
      return statusMarker(entry.status) ?? ("search" as const)
    case "tool":
      return statusMarker(entry.status) ?? ("code" as const)
    case "image":
      return statusMarker(entry.status) ?? ("image" as const)
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
      {entry.kind === "tool" ? (
        <ActivityToolCard entry={entry} onToolApproval={onToolApproval} />
      ) : null}
    </ActivityStep>
  )
}

function PanelBody({
  activity,
  onToolApproval,
  contentRef,
}: {
  activity?: AssistantActivityModel
  onToolApproval?: ToolApprovalHandler
  contentRef: RefCallback<HTMLElement>
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
    <div ref={contentRef}>
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
          {activity.completion ? (
            <ActivityEntryRow
              key={activity.completion.id}
              entry={activity.completion}
            />
          ) : null}
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
                  className="focus-visible:ring-focus-ring block overflow-hidden rounded-xl outline-none focus-visible:ring-2"
                >
                  <Image
                    src={result.imageUrl}
                    alt={result.title}
                    width={512}
                    height={512}
                    unoptimized
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
  turnKey,
  followLatest = false,
}: ActivityPanelProps) {
  const isBelowLg = useBreakpoint(LG_BREAKPOINT)
  const slotElement = useActivityPanelDockSlot()
  const { section } = useActivityPanelSectionTarget()
  const { viewportRef, contentRef } = useActivityPanelScrollFollow({
    turnKey,
    startAtEnd: followLatest && section === undefined,
    initialTargetPending: section !== undefined,
  })
  const close = () => onOpenChange(false)
  const body = (
    <PanelBody
      key={`${open ? "open" : "closed"}:${turnKey ?? "none"}`}
      activity={activity}
      onToolApproval={onToolApproval}
      contentRef={contentRef}
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
                viewportRef={dockedExpanded ? viewportRef : undefined}
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
            viewportRef={open ? viewportRef : undefined}
            className="min-h-0 flex-1"
          >
            <div className="px-6 pb-4">{body}</div>
          </ScrollArea>
        </ContentSheetShell>
      ) : null}
    </>
  )
}
