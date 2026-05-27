import { fetchMutation } from "convex/nextjs"
import type {
  UIMessage,
  UIMessageChunk,
  TextStreamPart,
  ToolSet,
  ToolUIPart,
} from "ai"
import { getStaticToolName, isStaticToolUIPart } from "ai"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import type { ToolSource } from "@/lib/tools/types"

export type DurableMessageStatus =
  | "submitted"
  | "streaming"
  | "completed"
  | "aborted"
  | "failed"
  | "awaiting_approval"

export type DurableUiMessage = UIMessage & {
  content: string
  createdAt: Date
  status: DurableMessageStatus
  metadata?: Record<string, unknown>
}

export type ApprovalResponseForPersistence = {
  messageId: string
  approvalId: string
  toolCallId: string
  toolName: string
  approved: boolean
  reason?: string
}

export function isDurableConvexChat(options: {
  isAuthenticated: boolean
  convexToken?: string
  chatId: string
}): boolean {
  return Boolean(
    options.isAuthenticated &&
      options.convexToken &&
      !options.chatId.startsWith("local-") &&
      !options.chatId.startsWith("optimistic-")
  )
}

export function extractTextFromParts(parts: UIMessage["parts"]) {
  let text = ""
  for (const part of parts) {
    if (part.type === "text") text += part.text
  }
  return text
}

export function getLatestUserMessage(
  messages: UIMessage[]
): UIMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === "user") return message
  }
  return undefined
}

export function toDurableUiMessage(
  message: Doc<"messages">
): DurableUiMessage {
  const parts = message.parts as UIMessage["parts"]
  const metadata =
    typeof message.metadata === "object" && message.metadata !== null
      ? (message.metadata as Record<string, unknown>)
      : {}

  return {
    id: message.clientMessageId ?? message._id,
    role:
      message.role === "data"
        ? "system"
        : (message.role as "user" | "assistant" | "system"),
    content: message.content,
    createdAt: new Date(message.createdAt),
    parts,
    metadata: {
      ...metadata,
      durableStatus: message.status,
      ...(message.error ? { durableError: message.error } : {}),
    },
    status: message.status,
  }
}

export function toDurableUiMessages(
  messages: Doc<"messages">[]
): DurableUiMessage[] {
  return messages.map(toDurableUiMessage)
}

function isApprovalRespondedToolPart(
  part: UIMessage["parts"][number]
): part is ToolUIPart & {
  state: "approval-responded"
  approval: { id: string; approved: boolean; reason?: string }
} {
  return (
    isStaticToolUIPart(part) &&
    part.state === "approval-responded" &&
    typeof part.approval?.id === "string" &&
    typeof part.approval.approved === "boolean"
  )
}

export function extractApprovalResponses(
  messages: UIMessage[]
): ApprovalResponseForPersistence[] {
  const responses: ApprovalResponseForPersistence[] = []

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isApprovalRespondedToolPart(part)) continue
      responses.push({
        messageId: message.id,
        approvalId: part.approval.id,
        toolCallId: part.toolCallId,
        toolName: String(getStaticToolName(part)),
        approved: part.approval.approved,
        ...(part.approval.reason ? { reason: part.approval.reason } : {}),
      })
    }
  }

  return responses
}

export function hasApprovalResponse(messages: UIMessage[]): boolean {
  return extractApprovalResponses(messages).length > 0
}

export function getFinalAssistantText(message: UIMessage): string {
  return extractTextFromParts(message.parts)
}

export function countToolParts(message: UIMessage): {
  totalToolCalls: number
  failedToolCalls: number
} {
  let totalToolCalls = 0
  let failedToolCalls = 0
  for (const part of message.parts) {
    if (!isStaticToolUIPart(part)) continue
    totalToolCalls++
    if (part.state === "output-error" || part.state === "output-denied") {
      failedToolCalls++
    }
  }
  return { totalToolCalls, failedToolCalls }
}

type SnapshotPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }

type DurableSnapshotTrackerOptions = {
  convexToken: string
  runId: Id<"generationRuns">
  chatId: Id<"chats">
  messageId: Id<"messages">
  order: number
  throttleMs?: number
}

export function createDurableSnapshotTracker(
  options: DurableSnapshotTrackerOptions
) {
  let text = ""
  let reasoning = ""
  let sequence = 0
  let lastWriteAt = 0
  let writeInFlight: Promise<unknown> | null = null
  let pending = false

  const getParts = (): SnapshotPart[] => [
    ...(reasoning ? [{ type: "reasoning" as const, text: reasoning }] : []),
    ...(text ? [{ type: "text" as const, text }] : []),
  ]

  const persist = async (force = false) => {
    const now = Date.now()
    const throttleMs = options.throttleMs ?? 750
    if (!force && now - lastWriteAt < throttleMs) {
      pending = true
      return
    }
    if (writeInFlight) {
      pending = true
      return
    }

    lastWriteAt = now
    pending = false
    const currentSequence = ++sequence
    writeInFlight = fetchMutation(
      api.chatRuntime.updateAssistantSnapshot,
      {
        runId: options.runId,
        chatId: options.chatId,
        messageId: options.messageId,
        order: options.order,
        sequence: currentSequence,
        textSnapshot: text,
        partsSnapshot: getParts(),
      },
      { token: options.convexToken }
    ).finally(() => {
      writeInFlight = null
    })

    await writeInFlight
    if (pending) await persist(force)
  }

  const onChunk = (chunk: TextStreamPart<ToolSet>) => {
    if (chunk.type === "text-delta") {
      text += chunk.text
      void persist(false)
    } else if (chunk.type === "reasoning-delta") {
      reasoning += chunk.text
      void persist(false)
    }
  }

  return {
    onChunk,
    flush: () => persist(true),
    get textSnapshot() {
      return text
    },
    get partsSnapshot() {
      return getParts()
    },
  }
}

export type ToolInvocationForPersistence = {
  toolCallId: string
  toolName: string
  source: ToolSource
  input?: unknown
  output?: unknown
  error?: string
  status:
    | "called"
    | "pending_approval"
    | "approved"
    | "denied"
    | "completed"
    | "failed"
  approvalRequestId?: string
}

export function sourceForTool(
  toolName: string,
  options: {
    mcpToolServerMap: ReadonlyMap<string, unknown>
    allToolMetadata: ReadonlyMap<string, { source?: ToolSource }>
  }
): ToolSource {
  if (options.mcpToolServerMap.has(toolName)) return "mcp"
  return options.allToolMetadata.get(toolName)?.source ?? "platform"
}

export function uiMessageChunkToPayload(
  chunk: UIMessageChunk
): Record<string, unknown> {
  return chunk as unknown as Record<string, unknown>
}
