import type { UIMessage } from "ai"
import {
  replayMessageSchema,
  type ReplayMessage,
  type ReplayPart,
  type ReplayProviderOrigin,
  type ReplayToolExchange,
  type ReplayWebSearchResult,
} from "./types"

export type ReplayNormalizationWarning = {
  code:
    | "message_invalid"
    | "part_invalid"
    | "part_unsupported"
    | "tool_non_replayable"
    | "tool_malformed"
  messageIndex: number
  partIndex?: number
  detail: string
}

export type ReplayNormalizationResult = {
  messages: ReplayMessage[]
  warnings: ReplayNormalizationWarning[]
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object"
}

function detectProviderOrigin(part: JsonRecord): ReplayProviderOrigin | undefined {
  const metadata = part.callProviderMetadata
  if (!isRecord(metadata)) return undefined
  if ("openai" in metadata) return "openai"
  if ("anthropic" in metadata) return "anthropic"
  if ("google" in metadata) return "google"
  if ("xai" in metadata) return "xai"
  return "unknown"
}

function toWebSearchResult(value: unknown): ReplayWebSearchResult | null {
  if (!isRecord(value) || typeof value.url !== "string" || value.url.length === 0) {
    return null
  }

  let snippet: string | undefined
  if (typeof value.snippet === "string") snippet = value.snippet
  else if (typeof value.content === "string") snippet = value.content
  else if (typeof value.text === "string") snippet = value.text

  return {
    url: value.url,
    title: typeof value.title === "string" ? value.title : undefined,
    snippet,
    pageAge:
      typeof value.pageAge === "string"
        ? value.pageAge
        : typeof value.page_age === "string"
          ? value.page_age
        : value.pageAge === null
          ? null
          : value.page_age === null
            ? null
          : undefined,
    encryptedContent:
      typeof value.encryptedContent === "string" ? value.encryptedContent : undefined,
    resultType:
      value.type === "web_search_result" ? "web_search_result" : undefined,
  }
}

function normalizeWebSearchShape(
  output: unknown,
): {
  rawShape: "object-action-sources" | "array-results" | "array-anthropic-native" | "unknown"
  results: ReplayWebSearchResult[]
} {
  if (isRecord(output) && Array.isArray(output.sources)) {
    return {
      rawShape: "object-action-sources",
      results: output.sources.map(toWebSearchResult).filter((item) => item !== null),
    }
  }

  if (Array.isArray(output)) {
    const hasAnthropicNativeFields = output.some(
      (item) =>
        isRecord(item) &&
        typeof item.encryptedContent === "string" &&
        item.type === "web_search_result",
    )
    return {
      rawShape: hasAnthropicNativeFields ? "array-anthropic-native" : "array-results",
      results: output.map(toWebSearchResult).filter((item) => item !== null),
    }
  }

  if (isRecord(output) && Array.isArray(output.results)) {
    return {
      rawShape: "array-results",
      results: output.results.map(toWebSearchResult).filter((item) => item !== null),
    }
  }

  return { rawShape: "unknown", results: [] }
}

function isToolPart(part: JsonRecord): boolean {
  return (
    (typeof part.type === "string" && part.type.startsWith("tool-")) ||
    part.type === "dynamic-tool"
  )
}

function normalizeToolExchange(part: JsonRecord): ReplayToolExchange {
  const toolName =
    typeof part.toolName === "string"
      ? part.toolName
      : typeof part.type === "string" && part.type.startsWith("tool-")
        ? part.type.slice("tool-".length)
        : "unknown"

  const base: ReplayToolExchange = {
    toolName,
    toolCallId: typeof part.toolCallId === "string" ? part.toolCallId : undefined,
    state: typeof part.state === "string" ? part.state : undefined,
    replayable: false,
    nonReplayableReason: "Tool replay not supported yet.",
  }

  if (toolName !== "web_search") {
    return {
      ...base,
      nonReplayableReason: `Unsupported tool for replay: ${toolName}`,
    }
  }

  const query =
    isRecord(part.input) && typeof part.input.query === "string" ? part.input.query : ""
  const { rawShape, results } = normalizeWebSearchShape(part.output)

  if (rawShape === "unknown") {
    return {
      ...base,
      nonReplayableReason: "Unsupported web_search output shape.",
      webSearch: {
        query,
        results: [],
        providerOrigin: detectProviderOrigin(part),
        rawShape,
      },
    }
  }

  return {
    toolName,
    toolCallId: typeof part.toolCallId === "string" ? part.toolCallId : undefined,
    state: typeof part.state === "string" ? part.state : undefined,
    replayable: true,
    webSearch: {
      query,
      results,
      providerOrigin: detectProviderOrigin(part),
      rawShape,
    },
  }
}

function normalizePart(part: unknown): ReplayPart | null {
  if (!isRecord(part) || typeof part.type !== "string") return null

  if (part.type === "text") {
    return { type: "text", text: typeof part.text === "string" ? part.text : "" }
  }

  if (part.type === "file") {
    return {
      type: "file",
      mediaType: typeof part.mediaType === "string" ? part.mediaType : undefined,
      filename: typeof part.filename === "string" ? part.filename : undefined,
      url: typeof part.url === "string" ? part.url : undefined,
    }
  }

  if (part.type === "source-url" && typeof part.url === "string" && part.url.length > 0) {
    return {
      type: "source-url",
      sourceId: typeof part.sourceId === "string" ? part.sourceId : undefined,
      url: part.url,
      title: typeof part.title === "string" ? part.title : undefined,
    }
  }

  if (isToolPart(part)) {
    return { type: "tool-exchange", tool: normalizeToolExchange(part) }
  }

  return null
}

export function normalizeReplayMessages(messages: readonly UIMessage[]): ReplayNormalizationResult {
  const warnings: ReplayNormalizationWarning[] = []
  const normalized: ReplayMessage[] = []

  messages.forEach((message, messageIndex) => {
    try {
      const role = message.role
      if (
        role !== "system" &&
        role !== "user" &&
        role !== "assistant" &&
        role !== "tool"
      ) {
        warnings.push({
          code: "message_invalid",
          messageIndex,
          detail: `Unsupported message role: ${String(role)}`,
        })
        return
      }

      const parts: ReplayPart[] = []
      const sourceParts = Array.isArray(message.parts) ? message.parts : []

      sourceParts.forEach((part, partIndex) => {
        try {
          const normalizedPart = normalizePart(part)
          if (!normalizedPart) {
            warnings.push({
              code: "part_unsupported",
              messageIndex,
              partIndex,
              detail: "Part type is not preserved for replay.",
            })
            return
          }

          if (normalizedPart.type === "tool-exchange" && !normalizedPart.tool.replayable) {
            warnings.push({
              code: "tool_non_replayable",
              messageIndex,
              partIndex,
              detail: normalizedPart.tool.nonReplayableReason ?? "Tool payload is non-replayable.",
            })
          }

          parts.push(normalizedPart)
        } catch (error) {
          warnings.push({
            code: "part_invalid",
            messageIndex,
            partIndex,
            detail:
              error instanceof Error
                ? error.message
                : "Unknown error while normalizing message part.",
          })
        }
      })

      const candidate = {
        id: message.id,
        role,
        parts,
      }

      const parsed = replayMessageSchema.safeParse(candidate)
      if (!parsed.success) {
        warnings.push({
          code: "message_invalid",
          messageIndex,
          detail: parsed.error.issues.map((issue) => issue.message).join("; "),
        })
        return
      }

      normalized.push(parsed.data)
    } catch (error) {
      warnings.push({
        code: "message_invalid",
        messageIndex,
        detail:
          error instanceof Error ? error.message : "Unknown error while normalizing message.",
      })
    }
  })

  return { messages: normalized, warnings }
}
