import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { sanitizeModelHistoryMessages as sanitizeSemanticModelHistoryMessages } from "@/convex/domain/message_visibility"
import type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"
import { extractTextFromMessageParts } from "@/lib/chat-messages/parts"
import { durableStoredMessageToUiMessage } from "@/lib/chat-messages/ui-message-adapter"
import { isServerChatId } from "@/lib/chat-store/identity"
import type { ToolSource } from "@/lib/tools/types"
import type {
  StreamTextTransform,
  TextStreamPart,
  ToolSet,
  ToolUIPart,
  UIMessage,
  UIMessageChunk,
} from "ai"
import { getStaticToolName, isStaticToolUIPart } from "ai"
import { fetchMutation } from "convex/nextjs"

export {
  hasSemanticAssistantParts,
  isModelHistoryMessage,
} from "@/convex/domain/message_visibility"

export type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"

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
    isServerChatId(options.chatId)
  )
}

export function extractTextFromParts(parts: UIMessage["parts"]) {
  return extractTextFromMessageParts(parts)
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

export function toDurableUiMessage(message: Doc<"messages">): DurableUiMessage {
  const uiMessage = durableStoredMessageToUiMessage(message, {
    partsMode: "stored",
    metadataMode: "runtime",
  })

  return {
    ...uiMessage,
    createdAt: new Date(message.createdAt),
    status: message.status,
  }
}

export function toDurableUiMessages(
  messages: Doc<"messages">[]
): DurableUiMessage[] {
  return messages.map(toDurableUiMessage)
}

export function sanitizeModelHistoryMessages(
  messages: UIMessage[]
): UIMessage[] {
  return sanitizeSemanticModelHistoryMessages(messages) as UIMessage[]
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

const SNAPSHOT_WRITE_TIMEOUT_MS = 10_000

class SnapshotWriteTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Timed out writing assistant snapshot after ${timeoutMs}ms`)
    this.name = "SnapshotWriteTimeoutError"
  }
}

function withSnapshotWriteTimeout<T>(write: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new SnapshotWriteTimeoutError(SNAPSHOT_WRITE_TIMEOUT_MS))
    }, SNAPSHOT_WRITE_TIMEOUT_MS)
  })

  return Promise.race([write, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

type DurableSnapshotTrackerOptions = {
  convexToken: string
  runId: Id<"generationRuns">
  chatId: Id<"chats">
  messageId: Id<"messages">
  order: number
  throttleMs?: number
  /**
   * Injected snapshot persister — defaults to the module `fetchMutation` so the
   * Chat turn runtime can thread its own injected `deps.fetchMutation` through,
   * making snapshot writes mockable without module-level mocking.
   */
  fetchMutation?: typeof fetchMutation
}

export function createDurableSnapshotTracker(
  options: DurableSnapshotTrackerOptions
) {
  const persistSnapshot = options.fetchMutation ?? fetchMutation
  let text = ""
  let reasoning = ""
  let sequence = 0
  let lastWriteAt = 0
  let writeInFlight: Promise<unknown> | null = null
  // Dirtiness is content-versioned, not a boolean: a persist loop re-runs only
  // when a chunk advanced the version past what the last completed write
  // captured. A shared `pending` flag let two overlapping flush() calls (the
  // streamText onAbort and the response-level onFinish both flush on Stop)
  // re-arm each other forever — neither flush resolved, markGenerationRunAborted
  // never ran, and snapshot writes continued at the write-latency rate.
  let contentVersion = 0
  let writtenVersion = 0

  const getParts = (): SnapshotPart[] => [
    ...(reasoning ? [{ type: "reasoning" as const, text: reasoning }] : []),
    ...(text ? [{ type: "text" as const, text }] : []),
  ]

  const persist = async (force = false) => {
    while (writtenVersion < contentVersion) {
      if (writeInFlight) {
        await writeInFlight
        continue
      }

      const now = Date.now()
      const throttleMs = options.throttleMs ?? 750
      if (!force && now - lastWriteAt < throttleMs) return

      lastWriteAt = now
      const versionAtWrite = contentVersion
      const currentSequence = ++sequence
      writeInFlight = withSnapshotWriteTimeout(
        persistSnapshot(
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
        )
      )
        .then((written) => {
          writtenVersion = Math.max(writtenVersion, versionAtWrite)
          return written
        })
        .finally(() => {
          writeInFlight = null
        })

      await writeInFlight
    }
  }

  const onChunk = (chunk: TextStreamPart<ToolSet>) => {
    if (chunk.type === "text-delta") {
      text += chunk.text
      contentVersion++
      void persist(false).catch(() => {})
    } else if (chunk.type === "reasoning-delta") {
      reasoning += chunk.text
      contentVersion++
      void persist(false).catch(() => {})
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

type RuntimeApprovalPersistenceDecision = {
  reason?: string
  riskClass?: string
}

type RuntimeApprovalPersistenceRunState = {
  runId: Id<"generationRuns">
  assistantMessageId: Id<"messages">
}

type ToolApprovalRequestPersistenceArgs = {
  chatId: Id<"chats">
  runId: Id<"generationRuns">
  assistantMessageId: Id<"messages">
  toolCallId: string
  toolName: string
  source: ToolSource
  reason?: string
  riskClass: string
  inputPreview?: string
  approvalId: string
}

/**
 * Minimal surface the approval-persistence transform needs from the Tool
 * runtime's metadata resolver: resolve a tool name to its source. The full
 * `ToolMetadataResolver` structurally satisfies this.
 */
type ToolSourceResolver = {
  source(toolName: string): ToolSource
}

type RuntimeApprovalPersistenceTransformOptions = {
  chatId: string
  convexToken: string
  durableRunState: RuntimeApprovalPersistenceRunState
  runtimeApprovalByToolName: ReadonlyMap<
    string,
    RuntimeApprovalPersistenceDecision
  >
  toolMetadataResolver: ToolSourceResolver
  approvalWritePromises: Array<Promise<unknown>>
  requestId: string
  persistApprovalRequest?: (
    args: ToolApprovalRequestPersistenceArgs
  ) => Promise<unknown>
}

export function createRuntimeApprovalPersistenceTransform({
  chatId,
  convexToken,
  durableRunState,
  runtimeApprovalByToolName,
  toolMetadataResolver,
  approvalWritePromises,
  requestId,
  persistApprovalRequest,
}: RuntimeApprovalPersistenceTransformOptions): StreamTextTransform<ToolSet> {
  const persist =
    persistApprovalRequest ??
    ((args: ToolApprovalRequestPersistenceArgs) =>
      fetchMutation(api.chatRuntime.createToolApprovalRequest, args, {
        token: convexToken,
      }))

  return () =>
    new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
      async transform(chunk, controller) {
        if (chunk.type === "tool-approval-request") {
          const toolName = chunk.toolCall.toolName
          const decision = runtimeApprovalByToolName.get(toolName)
          const source = toolMetadataResolver.source(toolName)
          const inputPreview = (() => {
            try {
              return JSON.stringify(chunk.toolCall.input).slice(0, 500)
            } catch {
              return String(chunk.toolCall.input).slice(0, 500)
            }
          })()

          const approvalWrite = (async () =>
            persist({
              chatId: chatId as Id<"chats">,
              runId: durableRunState.runId,
              assistantMessageId: durableRunState.assistantMessageId,
              toolCallId: chunk.toolCall.toolCallId,
              toolName,
              source,
              reason: decision?.reason,
              riskClass: decision?.riskClass ?? "unknown",
              inputPreview,
              approvalId: chunk.approvalId,
            }))()

          approvalWritePromises.push(approvalWrite)

          try {
            await approvalWrite
          } catch (error) {
            console.warn(
              JSON.stringify({
                _tag: "tool_approval_request_write_failed",
                requestId,
                chatId,
                toolCallId: chunk.toolCall.toolCallId,
                toolName,
                error: error instanceof Error ? error.message : String(error),
              })
            )
            throw error
          }
        }

        controller.enqueue(chunk)
      },
    })
}

export function uiMessageChunkToPayload(
  chunk: UIMessageChunk
): Record<string, unknown> {
  return chunk as unknown as Record<string, unknown>
}
