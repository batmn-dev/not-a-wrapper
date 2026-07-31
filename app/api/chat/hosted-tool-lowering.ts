import {
  isToolUIPart,
  safeValidateUIMessages,
  type ToolSet,
  type UIMessage,
} from "ai"

// Hosted-tool history lowering (cross-provider replay safety).
//
// Provider-executed ("hosted") tool activity — Anthropic/OpenAI/Google/xAI
// native web search — is persisted in durable history in the ORIGIN provider's
// wire shape, under the shared application tool key (`web_search`). A later
// turn may target a different provider whose same-named tool has an
// incompatible schema, and whose SDK cannot replay foreign hosted activity at
// all (the OpenAI Responses conversion turns provider-executed results into
// server-side `item_reference` lookups, which 400 on foreign or synthesized
// ids). Such parts must never reach tool-schema validation or the target
// provider as tool parts.
//
// This pass runs on HISTORY only (never the live continuation tail) and lowers
// any provider-executed tool part the CURRENT registry does not provably
// accept into a neutral text part carrying the query and titled citations —
// provider-neutral continuity, no fabricated hosted calls, no foreign ids, and
// never opaque payloads such as Anthropic's `encryptedContent`.

type MessagePart = UIMessage["parts"][number]

type HostedToolPartLike = {
  type: string
  state?: string
  toolCallId?: string
  providerExecuted?: boolean
  input?: unknown
  output?: unknown
}

export type HostedToolLoweringDetail = {
  messageIndex: number
  partIndex: number
  toolName: string
  reason: "tool_not_registered" | "schema_mismatch"
}

export type HostedToolLoweringResult = {
  messages: UIMessage[]
  loweredCount: number
  details: HostedToolLoweringDetail[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}

type Citation = { url: string; title?: string }

function toCitation(value: unknown): Citation | null {
  if (!isRecord(value) || typeof value.url !== "string" || !value.url) {
    return null
  }
  return {
    url: value.url,
    title: typeof value.title === "string" && value.title ? value.title : undefined,
  }
}

/**
 * Extract url/title citations from any known provider search-output shape:
 * Anthropic (array of results), OpenAI ({sources: [...]}), xAI
 * ({query, sources: [...]}), generic ({results: [...]}). Unknown shapes yield
 * no citations — the lowered text still records that a search happened.
 */
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
  const toolName = part.type.startsWith("tool-")
    ? part.type.slice("tool-".length)
    : part.type
  const query =
    isRecord(part.input) && typeof part.input.query === "string"
      ? part.input.query.trim()
      : ""
  const queryLabel = query ? ` for "${query}"` : ""

  if (toolName !== "web_search") {
    return `[A provider-hosted "${toolName}" tool ran in an earlier turn on a different provider; its raw result is not replayable here.]`
  }

  const citations = extractHostedSearchCitations(part.output).slice(
    0,
    MAX_LOWERED_CITATIONS
  )
  if (citations.length === 0) {
    return `[A web search${queryLabel} ran in an earlier turn; its results are not replayable on this provider.]`
  }

  const lines = citations.map(
    (citation) => `- ${citation.title ?? "Result"} (${citation.url})`
  )
  return `[Earlier web search${queryLabel} found:\n${lines.join("\n")}]`
}

/**
 * True when the current registry provably accepts this part: the tool exists
 * under the same name and the part passes the SDK's own tool-schema validation
 * (input for input/output-available states, output for output-available). Uses
 * `safeValidateUIMessages` on a single-part probe message so the acceptance
 * predicate is exactly the one `validateUIMessages` applies later.
 */
async function registryAcceptsPart(
  part: HostedToolPartLike,
  tools: ToolSet
): Promise<{ accepted: boolean; reason: HostedToolLoweringDetail["reason"] }> {
  const toolName = part.type.slice("tool-".length)
  if (!(toolName in tools)) {
    return { accepted: false, reason: "tool_not_registered" }
  }
  const probe = await safeValidateUIMessages({
    messages: [
      { id: "hosted-tool-probe", role: "assistant", parts: [part as MessagePart] },
    ],
    tools: tools as unknown as Parameters<
      typeof safeValidateUIMessages
    >[0]["tools"],
  })
  return { accepted: probe.success, reason: "schema_mismatch" }
}

function isHostedToolPart(
  part: MessagePart
): part is MessagePart & HostedToolPartLike & { type: `tool-${string}` } {
  // Static `tool-*` parts only: dynamic-tool parts (MCP) are client-executed
  // and never schema-validated by the SDK; client tool parts replay as
  // ordinary tool-call/result pairs.
  return (
    isToolUIPart(part) &&
    part.type !== "dynamic-tool" &&
    (part as HostedToolPartLike).providerExecuted === true
  )
}

/**
 * Lower foreign provider-hosted tool activity in history to neutral text.
 * Same-provider hosted parts that the current registry accepts pass through
 * untouched; everything else — foreign origin, changed schema, tool absent
 * this turn — becomes provider-neutral continuity text.
 */
export async function lowerForeignHostedToolParts(
  messages: readonly UIMessage[],
  tools: ToolSet
): Promise<HostedToolLoweringResult> {
  const details: HostedToolLoweringDetail[] = []
  const lowered: UIMessage[] = []

  for (const [messageIndex, message] of messages.entries()) {
    if (
      message.role !== "assistant" ||
      !message.parts.some((part) => isHostedToolPart(part))
    ) {
      lowered.push(message)
      continue
    }

    const parts: MessagePart[] = []
    for (const [partIndex, part] of message.parts.entries()) {
      if (!isHostedToolPart(part)) {
        parts.push(part)
        continue
      }

      const verdict = await registryAcceptsPart(part, tools)
      if (verdict.accepted) {
        parts.push(part)
        continue
      }

      details.push({
        messageIndex,
        partIndex,
        toolName: part.type.slice("tool-".length),
        reason: verdict.reason,
      })
      parts.push({
        type: "text",
        text: synthesizeLoweredText(part),
      } as MessagePart)
    }

    lowered.push({ ...message, parts })
  }

  return { messages: lowered, loweredCount: details.length, details }
}
