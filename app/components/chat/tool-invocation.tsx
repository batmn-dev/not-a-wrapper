"use client"

import { Icon } from "@/components/ui/icon"
import { getToolDisplayMetadataRecords } from "@/lib/chat-messages/metadata"
import {
  humanizeToolName,
  resolveToolInvocationMetadata,
  type ToolInvocationDisplayMetadata,
  type ToolInvocationStreamMetadata,
} from "@/lib/tools/ui-metadata"
import { cn } from "@/lib/utils"
import {
  RiCheckLine,
  RiCloseLine,
  RiCodeLine,
  RiFileSearchLine,
  RiImageLine,
  RiLink,
  RiLoader4Line,
  RiSearchLine,
  RiToolsLine,
  RiWrenchLine,
} from "@remixicon/react"
import type { ToolUIPart } from "ai"
import { getStaticToolName } from "ai"
import { useMemo, useRef, useState } from "react"
import { DisclosureCard } from "./disclosure-card"
import { deriveToolChipStatus, StatusChip } from "./status-chip"

type ToolInvocationProps = {
  toolInvocations: ToolUIPart[]
  /** The message's metadata; display records are read through the Message
   * metadata module (ADR-0002), never by casting raw keys. */
  metadata?: unknown
  /**
   * Whether the owning turn is still in a live phase (see
   * deriveAssistantTurnPhase). Tool part states never transition on
   * stop/abort/error, so an in-flight part on a settled turn must present as
   * "Stopped", not an animated "Running". Defaults to true for callers that
   * only render live turns.
   */
  turnActive?: boolean
  className?: string
  defaultOpen?: boolean
  onToolApproval?: ToolApprovalHandler
}

type ToolApprovalHandler = (
  approvalId: string,
  approved: boolean,
  reason?: string
) => Promise<void> | void

/** Maps built-in tool names to human-readable display names and icons */
const BUILTIN_TOOL_DISPLAY: Record<
  string,
  { name: string; icon: "search" | "code" | "image" | "extract" | "wrench" }
> = {
  web_search: { name: "Web Search", icon: "search" },
  google_search: { name: "Web Search", icon: "search" },
  extract_content: { name: "Read Page", icon: "extract" },
  // Future built-in tools:
  // code_execution: { name: "Code Execution", icon: "code" },
  // image_generation: { name: "Image Generation", icon: "image" },
}

function ToolInvocationIcon({
  iconId,
  size,
  className,
}: {
  iconId: NonNullable<ToolInvocationDisplayMetadata["icon"]>
  size: number
  className?: string
}) {
  switch (iconId) {
    case "search":
      return <Icon icon={RiSearchLine} slotSize={size} className={className} />
    case "code":
      return <Icon icon={RiCodeLine} slotSize={size} className={className} />
    case "image":
      return <Icon icon={RiImageLine} slotSize={size} className={className} />
    case "extract":
      return (
        <Icon icon={RiFileSearchLine} slotSize={size} className={className} />
      )
    case "wrench":
      return <Icon icon={RiWrenchLine} slotSize={size} className={className} />
    default:
      return <Icon icon={RiWrenchLine} slotSize={size} className={className} />
  }
}

function isToolSource(
  value: unknown
): value is ToolInvocationDisplayMetadata["source"] {
  return (
    value === "builtin" ||
    value === "third-party" ||
    value === "mcp" ||
    value === "platform"
  )
}

function isToolIcon(
  value: unknown
): value is NonNullable<ToolInvocationDisplayMetadata["icon"]> {
  return (
    value === "search" ||
    value === "code" ||
    value === "image" ||
    value === "extract" ||
    value === "wrench"
  )
}

function isToolInvocationDisplayMetadata(
  value: unknown
): value is ToolInvocationDisplayMetadata {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.displayName !== "string") return false
  if (!isToolSource(candidate.source)) return false
  if (typeof candidate.serviceName !== "string") return false
  if (candidate.icon !== undefined && !isToolIcon(candidate.icon)) return false
  if (
    candidate.estimatedCostPer1k !== undefined &&
    typeof candidate.estimatedCostPer1k !== "number"
  )
    return false
  if (
    candidate.readOnly !== undefined &&
    typeof candidate.readOnly !== "boolean"
  )
    return false
  if (
    candidate.destructive !== undefined &&
    typeof candidate.destructive !== "boolean"
  )
    return false
  if (
    candidate.idempotent !== undefined &&
    typeof candidate.idempotent !== "boolean"
  )
    return false
  if (
    candidate.openWorld !== undefined &&
    typeof candidate.openWorld !== "boolean"
  )
    return false
  return true
}

function toMetadataRecord(
  value: unknown
): Record<string, ToolInvocationDisplayMetadata> {
  if (typeof value !== "object" || value === null) return {}
  const record = value as Record<string, unknown>
  const parsed: Record<string, ToolInvocationDisplayMetadata> = {}

  for (const [key, candidate] of Object.entries(record)) {
    if (isToolInvocationDisplayMetadata(candidate)) {
      parsed[key] = candidate
    }
  }

  return parsed
}

function getToolMetadataMaps(metadata: unknown) {
  const records = getToolDisplayMetadataRecords(metadata)
  return {
    byName: toMetadataRecord(records.byName),
    byCallId: toMetadataRecord(records.byCallId),
  }
}

function formatSource(source: ToolInvocationDisplayMetadata["source"]): string {
  switch (source) {
    case "builtin":
      return "Built-in"
    case "third-party":
      return "Third-party"
    case "platform":
      return "Platform"
    case "mcp":
      return "MCP"
    default:
      return "Unknown"
  }
}

export function ToolInvocation({
  toolInvocations,
  metadata,
  turnActive = true,
  defaultOpen = false,
  onToolApproval,
}: ToolInvocationProps) {
  const { byName, byCallId } = useMemo(
    () => getToolMetadataMaps(metadata),
    [metadata]
  )

  const toolInvocationsData = Array.isArray(toolInvocations)
    ? toolInvocations
    : [toolInvocations]

  // Group tool invocations by toolCallId
  const groupedTools = toolInvocationsData.reduce(
    (acc, item) => {
      const { toolCallId } = item
      if (!acc[toolCallId]) {
        acc[toolCallId] = []
      }
      acc[toolCallId].push(item)
      return acc
    },
    {} as Record<string, ToolUIPart[]>
  )

  const uniqueToolIds = Object.keys(groupedTools)
  const isSingleTool = uniqueToolIds.length === 1

  if (isSingleTool) {
    return (
      <SingleToolView
        toolInvocations={toolInvocationsData}
        metadataByName={byName}
        metadataByCallId={byCallId}
        turnActive={turnActive}
        defaultOpen={defaultOpen}
        className="mb-10"
        onToolApproval={onToolApproval}
      />
    )
  }

  return (
    <div className="mb-10">
      <DisclosureCard
        defaultOpen={defaultOpen}
        header={
          <>
            <Icon
              icon={RiToolsLine}
              slotSize={16}
              className="text-muted-foreground"
            />
            <span className="text-sm">Tools executed</span>
            <div className="bg-secondary text-secondary-foreground rounded-full px-1.5 py-0.5 font-mono text-xs">
              {uniqueToolIds.length}
            </div>
          </>
        }
      >
        <div className="space-y-2">
          {uniqueToolIds.map((toolId) => {
            const toolInvocationsForId = groupedTools[toolId]

            if (!toolInvocationsForId?.length) return null

            return (
              <div key={toolId} className="pb-2 last:border-0 last:pb-0">
                <SingleToolView
                  toolInvocations={toolInvocationsForId}
                  metadataByName={byName}
                  metadataByCallId={byCallId}
                  turnActive={turnActive}
                  onToolApproval={onToolApproval}
                />
              </div>
            )
          })}
        </div>
      </DisclosureCard>
    </div>
  )
}

type SingleToolViewProps = {
  toolInvocations: ToolUIPart[]
  metadataByName: Record<string, ToolInvocationDisplayMetadata>
  metadataByCallId: Record<string, ToolInvocationDisplayMetadata>
  turnActive?: boolean
  defaultOpen?: boolean
  className?: string
  onToolApproval?: ToolApprovalHandler
}

function SingleToolView({
  toolInvocations,
  metadataByName,
  metadataByCallId,
  turnActive = true,
  defaultOpen = false,
  className,
  onToolApproval,
}: SingleToolViewProps) {
  // Group by toolCallId and pick the most informative state
  const groupedTools = toolInvocations.reduce(
    (acc, item) => {
      const { toolCallId } = item
      if (!acc[toolCallId]) {
        acc[toolCallId] = []
      }
      acc[toolCallId].push(item)
      return acc
    },
    {} as Record<string, ToolUIPart[]>
  )

  // For each toolCallId, get the most informative state.
  // An approved response only means the tool may proceed; it is not terminal.
  const toolsToDisplay = Object.values(groupedTools)
    .map((group) => {
      const resultTool = group.find((item) => item.state === "output-available")
      const approvalTool = group.find(
        (item) => item.state === "approval-requested"
      )
      const deniedApprovalResponseTool = group.find(
        (item) =>
          item.state === "approval-responded" &&
          "approval" in item &&
          item.approval.approved === false
      )
      const approvalResponseTool = group.find(
        (item) => item.state === "approval-responded"
      )
      const callTool = group.find((item) => item.state === "input-available")
      const partialCallTool = group.find(
        (item) => item.state === "input-streaming"
      )

      // Return the most informative one
      return (
        resultTool ||
        deniedApprovalResponseTool ||
        approvalTool ||
        callTool ||
        partialCallTool ||
        approvalResponseTool
      )
    })
    .filter(Boolean) as ToolUIPart[]

  if (toolsToDisplay.length === 0) return null

  // If there's only one tool, display it directly
  if (toolsToDisplay.length === 1) {
    return (
      <SingleToolCard
        toolData={toolsToDisplay[0]}
        metadataByName={metadataByName}
        metadataByCallId={metadataByCallId}
        turnActive={turnActive}
        defaultOpen={defaultOpen}
        className={className}
        onToolApproval={onToolApproval}
      />
    )
  }

  // If there are multiple tools, show them in a list
  return (
    <div className={className}>
      <div className="space-y-4">
        {toolsToDisplay.map((tool) => (
          <SingleToolCard
            key={tool.toolCallId}
            toolData={tool}
            metadataByName={metadataByName}
            metadataByCallId={metadataByCallId}
            turnActive={turnActive}
            defaultOpen={defaultOpen}
            onToolApproval={onToolApproval}
          />
        ))}
      </div>
    </div>
  )
}

// New component to handle individual tool cards
function SingleToolCard({
  toolData,
  metadataByName,
  metadataByCallId,
  turnActive = true,
  defaultOpen = false,
  className,
  onToolApproval,
}: {
  toolData: ToolUIPart
  metadataByName: Record<string, ToolInvocationDisplayMetadata>
  metadataByCallId: Record<string, ToolInvocationDisplayMetadata>
  turnActive?: boolean
  defaultOpen?: boolean
  className?: string
  onToolApproval?: ToolApprovalHandler
}) {
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false)
  const isSubmittingApprovalRef = useRef(false)
  const { state, toolCallId } = toolData
  const toolName = getStaticToolName(toolData)
  const streamMetadata: ToolInvocationStreamMetadata = {
    toolMetadataByName: metadataByName,
    toolMetadataByCallId: metadataByCallId,
  }
  const runtimeMetadata = resolveToolInvocationMetadata({
    toolName,
    toolCallId,
    streamMetadata,
  })
  const displayInfo = BUILTIN_TOOL_DISPLAY[toolName] ?? null
  const displayName =
    runtimeMetadata?.displayName ??
    displayInfo?.name ??
    humanizeToolName(toolName)
  const iconId = runtimeMetadata?.icon ?? displayInfo?.icon ?? "wrench"
  const source = runtimeMetadata?.source
  const serviceName = runtimeMetadata?.serviceName
  const estimatedCostPer1k = runtimeMetadata?.estimatedCostPer1k
  const readOnly = runtimeMetadata?.readOnly
  const destructive = runtimeMetadata?.destructive
  const idempotent = runtimeMetadata?.idempotent
  const openWorld = runtimeMetadata?.openWorld
  const args = toolData.input as Record<string, unknown> | undefined
  const isApprovalRequested = state === "approval-requested"
  const isInFlightState =
    state === "input-available" ||
    state === "input-streaming" ||
    isApprovalRequested
  // Part states freeze in place on stop/abort/error — a settled turn presents
  // an in-flight part as "Stopped", never an animated/actionable state.
  const isLoading = isInFlightState && turnActive
  const isStopped = isInFlightState && !turnActive
  const isAwaitingApproval = isApprovalRequested && turnActive
  const isApprovalResponded = state === "approval-responded"
  const isCompleted = state === "output-available"
  const result = isCompleted ? toolData.output : undefined
  const approvalId =
    isAwaitingApproval && "approval" in toolData
      ? toolData.approval.id
      : undefined
  const approvalResponse =
    isApprovalResponded && "approval" in toolData ? toolData.approval : null
  const isError =
    isCompleted &&
    result != null &&
    typeof result === "object" &&
    "isError" in result &&
    (result as Record<string, unknown>).isError === true

  // Parse the result JSON if available
  const { parsedResult, parseError } = useMemo(() => {
    if (!isCompleted || !result) return { parsedResult: null, parseError: null }

    try {
      if (Array.isArray(result))
        return { parsedResult: result, parseError: null }

      if (
        typeof result === "object" &&
        result !== null &&
        "content" in result
      ) {
        const resultObj = result as {
          content?: Array<{ type: string; text?: string }>
        }
        const textContent = resultObj.content?.find(
          (item) => item.type === "text"
        )
        if (!textContent?.text) return { parsedResult: null, parseError: null }

        try {
          return {
            parsedResult: JSON.parse(textContent.text),
            parseError: null,
          }
        } catch {
          return { parsedResult: textContent.text, parseError: null }
        }
      }

      return { parsedResult: result, parseError: null }
    } catch {
      return { parsedResult: null, parseError: "Failed to parse result" }
    }
  }, [isCompleted, result])

  const submitToolApproval = async (approved: boolean, reason?: string) => {
    if (
      !onToolApproval ||
      !approvalId ||
      !turnActive ||
      isSubmittingApprovalRef.current
    ) {
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

  // Format the arguments for display
  const formattedArgs = args
    ? Object.entries(args).map(([key, value]) => (
        <div key={key} className="mb-1">
          <span className="text-muted-foreground font-medium">{key}:</span>{" "}
          <span className="font-mono">
            {typeof value === "object"
              ? value === null
                ? "null"
                : Array.isArray(value)
                  ? value.length === 0
                    ? "[]"
                    : JSON.stringify(value)
                  : JSON.stringify(value)
              : String(value)}
          </span>
        </div>
      ))
    : null

  // Render generic results based on their structure
  const renderResults = () => {
    if (!parsedResult) return "No result data available"

    // Handle array of items with url, title, and snippet (like search results)
    if (Array.isArray(parsedResult) && parsedResult.length > 0) {
      // Check if items look like search results
      if (
        parsedResult[0] &&
        typeof parsedResult[0] === "object" &&
        "url" in parsedResult[0] &&
        "title" in parsedResult[0]
      ) {
        return (
          <div className="space-y-3">
            {parsedResult.map(
              (
                item: { url: string; title: string; snippet?: string },
                index: number
              ) => (
                <div
                  key={index}
                  className="border-border border-b pb-3 last:border-0 last:pb-0"
                >
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary group flex items-center gap-1 font-medium hover:underline"
                  >
                    {item.title}
                    <Icon
                      icon={RiLink}
                      slotSize={12}
                      className="opacity-70 transition-opacity group-hover:opacity-100"
                    />
                  </a>
                  <div className="text-muted-foreground mt-1 font-mono text-xs">
                    {item.url}
                  </div>
                  {item.snippet && (
                    <div className="mt-1 line-clamp-2 text-sm">
                      {item.snippet}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        )
      }

      // Generic array display
      return (
        <div className="font-mono text-xs">
          <pre className="whitespace-pre-wrap">
            {JSON.stringify(parsedResult, null, 2)}
          </pre>
        </div>
      )
    }

    // Handle object results
    if (typeof parsedResult === "object" && parsedResult !== null) {
      const resultObj = parsedResult as Record<string, unknown>
      const title = typeof resultObj.title === "string" ? resultObj.title : null
      const htmlUrl =
        typeof resultObj.html_url === "string" ? resultObj.html_url : null

      return (
        <div>
          {title && <div className="mb-2 font-medium">{title}</div>}
          {htmlUrl && (
            <div className="mb-2">
              <a
                href={htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary flex items-center gap-1 hover:underline"
              >
                <span className="font-mono">{htmlUrl}</span>
                <Icon icon={RiLink} slotSize={12} className="opacity-70" />
              </a>
            </div>
          )}
          <div className="font-mono text-xs">
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(parsedResult, null, 2)}
            </pre>
          </div>
        </div>
      )
    }

    // Handle string results — rendered as raw text intentionally.
    // Tool output may contain JSON, code, or bracket/paren characters
    // that would be misinterpreted by a markdown renderer.
    if (typeof parsedResult === "string") {
      return <div className="whitespace-pre-wrap">{parsedResult}</div>
    }

    // Fallback
    return "No result data available"
  }

  return (
    <DisclosureCard
      defaultOpen={defaultOpen}
      className={className}
      header={
        <>
          <ToolInvocationIcon
            iconId={iconId}
            size={16}
            className="text-muted-foreground"
          />
          <div className="flex min-w-0 flex-col">
            <span
              className={cn(
                "truncate text-sm",
                runtimeMetadata || displayInfo ? "" : "font-mono"
              )}
            >
              {displayName}
            </span>
            {(source || serviceName) && (
              <span className="text-muted-foreground truncate text-xs">
                {[source ? formatSource(source) : null, serviceName]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
          <StatusChip
            status={deriveToolChipStatus({
              isAwaitingApproval,
              isLoading,
              isStopped,
              isError,
              isDenied: Boolean(
                isApprovalResponded && approvalResponse?.approved === false
              ),
            })}
          />
        </>
      }
    >
      <div className="space-y-3">
        {/* Arguments section */}
        {args && Object.keys(args).length > 0 && (
          <div>
            <div className="text-muted-foreground mb-1 text-xs font-medium">
              Arguments
            </div>
            <div className="bg-background rounded border p-2 text-sm">
              {formattedArgs}
            </div>
          </div>
        )}

        {isAwaitingApproval && approvalId && (
          <div>
            <div className="text-muted-foreground mb-1 text-xs font-medium">
              Approval required
            </div>
            <div className="bg-background rounded border p-2 text-sm">
              <div className="text-muted-foreground mb-2">
                Review this tool call before it runs.
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex h-8 items-center rounded-md border border-green-200 bg-green-50 px-3 text-sm font-medium text-green-700 transition-colors hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400 dark:hover:bg-green-950/50"
                  disabled={!onToolApproval || isSubmittingApproval}
                  onClick={(event) => {
                    event.preventDefault()
                    void submitToolApproval(true)
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center rounded-md border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
                  disabled={!onToolApproval || isSubmittingApproval}
                  onClick={(event) => {
                    event.preventDefault()
                    void submitToolApproval(false, "Denied by user")
                  }}
                >
                  Deny
                </button>
              </div>
            </div>
          </div>
        )}

        {isApprovalResponded && approvalResponse?.approved === false && (
          <div>
            <div className="text-muted-foreground mb-1 text-xs font-medium">
              Approval denied
            </div>
            <div className="bg-background rounded border p-2 text-sm">
              {approvalResponse.reason || "Denied by user"}
            </div>
          </div>
        )}

        {/* Result section */}
        {isCompleted && (
          <div>
            <div className="text-muted-foreground mb-1 text-xs font-medium">
              Result
            </div>
            <div className="bg-background max-h-60 overflow-auto rounded border p-2 text-sm">
              {parseError ? (
                <div className="text-red-500">{parseError}</div>
              ) : (
                renderResults()
              )}
            </div>
          </div>
        )}

        {(source ||
          serviceName ||
          typeof estimatedCostPer1k === "number" ||
          typeof readOnly === "boolean" ||
          typeof destructive === "boolean" ||
          typeof idempotent === "boolean" ||
          typeof openWorld === "boolean") && (
          <div>
            <div className="text-muted-foreground mb-1 text-xs font-medium">
              Tool info
            </div>
            <div className="bg-background space-y-1 rounded border p-2 text-sm">
              {source && (
                <div>
                  <span className="text-muted-foreground font-medium">
                    Source:
                  </span>{" "}
                  {formatSource(source)}
                </div>
              )}
              {serviceName && (
                <div>
                  <span className="text-muted-foreground font-medium">
                    Service:
                  </span>{" "}
                  {serviceName}
                </div>
              )}
              {typeof estimatedCostPer1k === "number" && (
                <div>
                  <span className="text-muted-foreground font-medium">
                    Estimated cost:
                  </span>{" "}
                  ${estimatedCostPer1k.toFixed(2)} / 1k calls
                </div>
              )}
              {typeof readOnly === "boolean" && (
                <div>
                  <span className="text-muted-foreground font-medium">
                    Read-only:
                  </span>{" "}
                  {readOnly ? "Yes" : "No"}
                </div>
              )}
              {typeof destructive === "boolean" && (
                <div>
                  <span className="text-muted-foreground font-medium">
                    Destructive:
                  </span>{" "}
                  {destructive ? "Yes" : "No"}
                </div>
              )}
              {typeof idempotent === "boolean" && (
                <div>
                  <span className="text-muted-foreground font-medium">
                    Idempotent:
                  </span>{" "}
                  {idempotent ? "Yes" : "No"}
                </div>
              )}
              {typeof openWorld === "boolean" && (
                <div>
                  <span className="text-muted-foreground font-medium">
                    Open-world:
                  </span>{" "}
                  {openWorld ? "Yes" : "No"}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tool call ID */}
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <div className="flex items-center">
            <Icon icon={RiCodeLine} slotSize={12} className="mr-1" />
            Tool Call ID: <span className="ml-1 font-mono">{toolCallId}</span>
          </div>
        </div>
      </div>
    </DisclosureCard>
  )
}
