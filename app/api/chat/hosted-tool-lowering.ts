import { isToolUIPart, type ToolSet, type UIMessage } from "ai"

// Provider-executed activity is canonical evidence of what an origin provider
// did, not a portable tool exchange. Installed targets disagree on how such
// parts replay: OpenAI emits server-side item references, Anthropic requires
// opaque encrypted results, Google has separate grounding/server-tool shapes,
// and xAI drops provider-executed calls from request history. Consequently no
// provider-hosted history is sent back as a tool part. This model-bound pass
// projects it to provider-neutral text while leaving canonical persistence
// untouched. Approval continuations are checked separately because they are a
// live, provider-pinned protocol continuation rather than history.

type MessagePart = UIMessage["parts"][number]

type HostedToolPartLike = {
  type: string
  toolName?: string
  state?: string
  toolCallId?: string
  providerExecuted?: boolean
  input?: unknown
  output?: unknown
}

export type HostedToolLoweringReason =
  | "dynamic_provider_tool"
  | "provider_hosted_history"
  | "provider_mismatch"
  | "tool_identity_mismatch"
  | "tool_not_registered"
  | "unsafe_state"
  | "untrusted_provenance"

export type HostedToolLoweringDetail = {
  messageIndex: number
  partIndex: number
  toolName: string
  originProvider?: string
  targetProvider: string
  reason: HostedToolLoweringReason
}

export type HostedSourceProjectionDetail = {
  messageIndex: number
  partIndex: number
}

export type HostedToolLoweringResult = {
  messages: UIMessage[]
  loweredCount: number
  sourceProjectionCount: number
  details: HostedToolLoweringDetail[]
  sourceDetails: HostedSourceProjectionDetail[]
}

export type HostedToolLoweringOptions = {
  targetProvider: string
  tools: ToolSet
}

function inferTargetProvider(tools: ToolSet): string {
  for (const tool of Object.values(tools)) {
    if (tool.type !== "provider" || typeof tool.id !== "string") continue
    const [provider] = tool.id.split(".")
    if (provider) return provider
  }
  return "unknown"
}

function normalizeOptions(
  options: HostedToolLoweringOptions | ToolSet
): HostedToolLoweringOptions {
  if (
    Object.prototype.hasOwnProperty.call(options, "targetProvider") &&
    typeof options.targetProvider === "string" &&
    Object.prototype.hasOwnProperty.call(options, "tools")
  ) {
    return options as HostedToolLoweringOptions
  }
  return {
    targetProvider: inferTargetProvider(options as ToolSet),
    tools: options as ToolSet,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function getMessageOriginProvider(message: UIMessage): string | undefined {
  if (!isRecord(message.metadata)) return undefined
  const provider = message.metadata.provider
  return typeof provider === "string" && provider.length > 0
    ? provider
    : undefined
}

function hasOwnTool(tools: ToolSet, toolName: string): boolean {
  return Object.prototype.hasOwnProperty.call(tools, toolName)
}

function getToolName(part: HostedToolPartLike): string {
  return part.type === "dynamic-tool"
    ? typeof part.toolName === "string" && part.toolName.length > 0
      ? part.toolName
      : "unknown"
    : part.type.slice("tool-".length)
}

type Citation = { url: string; title?: string }

function toCitation(value: unknown): Citation | null {
  if (!isRecord(value) || typeof value.url !== "string" || !value.url) {
    return null
  }
  return {
    url: value.url,
    title:
      typeof value.title === "string" && value.title ? value.title : undefined,
  }
}

/** Extract only display-safe citation fields; opaque provider payloads drop. */
export function extractHostedSearchCitations(output: unknown): Citation[] {
  if (Array.isArray(output)) {
    return output.map(toCitation).filter((item): item is Citation => !!item)
  }
  if (isRecord(output)) {
    const list = Array.isArray(output.sources)
      ? output.sources
      : Array.isArray(output.results)
        ? output.results
        : []
    return list.map(toCitation).filter((item): item is Citation => !!item)
  }
  return []
}

const MAX_LOWERED_CITATIONS = 5

function synthesizeLoweredText(part: HostedToolPartLike): string {
  const toolName = getToolName(part)
  const state = typeof part.state === "string" ? part.state : "unknown"
  const query =
    isRecord(part.input) && typeof part.input.query === "string"
      ? part.input.query.trim()
      : ""
  const queryLabel = query ? ` for "${query}"` : ""

  if (toolName !== "web_search") {
    return `[A provider-hosted "${toolName}" tool reached ${state} in an earlier turn; its provider-native payload was omitted from replay.]`
  }

  const citations = extractHostedSearchCitations(part.output).slice(
    0,
    MAX_LOWERED_CITATIONS
  )
  if (citations.length === 0) {
    return `[A web search${queryLabel} reached ${state} in an earlier turn; its provider-native payload was omitted from replay.]`
  }

  const lines = citations.map(
    (citation) => `- ${citation.title ?? "Result"} (${citation.url})`
  )
  return `[Earlier web search${queryLabel} found:\n${lines.join("\n")}]`
}

function synthesizeSourceText(part: MessagePart): string | null {
  if (part.type !== "source-url") return null
  const title =
    typeof part.title === "string" && part.title ? part.title : "Source"
  return `[Earlier cited source: ${title} (${part.url})]`
}

function isHostedToolPart(
  part: MessagePart
): part is MessagePart & HostedToolPartLike {
  return isToolUIPart(part) && part.providerExecuted === true
}

const SAFE_HISTORICAL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
])

function classifyHostedPart(options: {
  part: HostedToolPartLike
  originProvider?: string
  targetProvider: string
  tools: ToolSet
}): HostedToolLoweringReason {
  const { part, originProvider, targetProvider, tools } = options
  const toolName = getToolName(part)
  if (!originProvider) return "untrusted_provenance"
  if (!SAFE_HISTORICAL_STATES.has(part.state ?? "")) return "unsafe_state"
  if (part.type === "dynamic-tool") return "dynamic_provider_tool"
  if (!hasOwnTool(tools, toolName)) return "tool_not_registered"
  if (originProvider !== targetProvider) return "provider_mismatch"

  const registeredTool = tools[toolName] as
    { type?: string; id?: string; isProviderExecuted?: boolean } | undefined
  if (
    registeredTool?.type !== "provider" ||
    registeredTool.isProviderExecuted !== true ||
    typeof registeredTool.id !== "string" ||
    !registeredTool.id.startsWith(`${targetProvider}.`)
  ) {
    return "tool_identity_mismatch"
  }

  // Even an exact same-provider registry match is schema acceptance, not
  // replay compatibility. Historical hosted activity is always projected.
  return "provider_hosted_history"
}

/**
 * Project provider-hosted history and provider grounding sources to safe text.
 * Client-executed tool pairs are left for the normal provider adapters.
 */
export function lowerForeignHostedToolParts(
  messages: readonly UIMessage[],
  rawOptions: HostedToolLoweringOptions | ToolSet
): HostedToolLoweringResult {
  const options = normalizeOptions(rawOptions)
  const details: HostedToolLoweringDetail[] = []
  const sourceDetails: HostedSourceProjectionDetail[] = []
  const lowered: UIMessage[] = []

  for (const [messageIndex, message] of messages.entries()) {
    const originProvider = getMessageOriginProvider(message)
    const parts: MessagePart[] = []
    let changed = false

    for (const [partIndex, part] of message.parts.entries()) {
      if (isHostedToolPart(part)) {
        const toolName = getToolName(part)
        details.push({
          messageIndex,
          partIndex,
          toolName,
          originProvider,
          targetProvider: options.targetProvider,
          reason: classifyHostedPart({
            part,
            originProvider,
            targetProvider: options.targetProvider,
            tools: options.tools,
          }),
        })
        parts.push({ type: "text", text: synthesizeLoweredText(part) })
        changed = true
        continue
      }

      const sourceText = synthesizeSourceText(part)
      if (sourceText !== null) {
        sourceDetails.push({ messageIndex, partIndex })
        parts.push({ type: "text", text: sourceText })
        changed = true
        continue
      }

      parts.push(part)
    }

    lowered.push(changed ? ({ ...message, parts } as UIMessage) : message)
  }

  return {
    messages: lowered,
    loweredCount: details.length,
    sourceProjectionCount: sourceDetails.length,
    details,
    sourceDetails,
  }
}
