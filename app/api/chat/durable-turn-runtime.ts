import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { sanitizeModelHistoryMessages as sanitizeSemanticModelHistoryMessages } from "@/convex/domain/message_visibility"
import { projectPersistedMessageMetadata } from "@/convex/lib/messageMetadata"
import type {
  ChatTurnEditRequest,
  ChatTurnRegenerationRequest,
} from "@/lib/chat-messages/chat-turn-contract"
import type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"
import { extractTextFromMessageParts } from "@/lib/chat-messages/parts"
import { durableStoredMessageToUiMessage } from "@/lib/chat-messages/ui-message-adapter"
import { isServerChatId } from "@/lib/chat-store/identity"
import type { ToolSource } from "@/lib/tools/types"
import * as Sentry from "@sentry/nextjs"
import type {
  UIMessage as MessageAISDK,
  StreamTextTransform,
  TextStreamPart,
  ToolApprovalStatus,
  ToolSet,
  ToolUIPart,
  UIMessage,
} from "ai"
import { getStaticToolName, isStaticToolUIPart } from "ai"
import { fetchMutation as defaultFetchMutation } from "convex/nextjs"
import { isConvexArgumentValidationError } from "./utils"

// Owns durable preparation, snapshots, tool invocations, approvals, terminal
// writes, and the typed handoff between model-stream and UI-stream completion.
// Guest turns use an inert adapter (ADR-0009).

export type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"

// Edit/regeneration request shapes live on the Chat turn wire contract
// (lib/chat-messages/chat-turn-contract.ts) — declared once for the client
// builder and this consumer.

/**
 * The durable-turn slice of the admitted Chat turn. Everything but `provider`
 * crosses at construction (the convex token once, here); `provider` crosses at
 * `prepare({ provider })` because it is resolved mid-parent-prepare.
 */
export type DurableTurnInput = {
  chatId: string
  requestId: string
  model: string
  messages: MessageAISDK[]
  isAuthenticated: boolean
  convexToken: string | undefined
  edit?: ChatTurnEditRequest
  regeneration?: ChatTurnRegenerationRequest
  expectedVisibleMessageCount?: number
  tailMessageId?: string
}

/**
 * Injected Convex wire — the established `fetchMutation` seam, faked in tests.
 * Deliberately not a `DurableStore` port (ADR-0009 §Ports): a 7-method port
 * would re-declare what Convex codegen already declares.
 */
export type DurableTurnDeps = {
  fetchMutation: typeof defaultFetchMutation
}

/**
 * The one port onto the Tool runtime. Structural — `ToolRuntime` satisfies it
 * as-is, tests hand in a literal. Subsumes the map+resolver threading the
 * approval-persistence transform used to require: `approvalFor` carries the
 * `reason`/`riskClass` the transform reads. `outcomeSummary()` is deliberately
 * excluded — finish counts are pushed as data via `captureFinish`.
 */
export type ToolFacts = {
  metadata: { source(toolName: string): ToolSource }
  approvalFor(
    toolName: string
  ):
    { needsApproval?: boolean; reason?: string; riskClass?: string } | undefined
  toolApproval: Record<string, ToolApprovalStatus> | undefined
}

/**
 * The spreadable streamText extras: the call-site approval gate plus the
 * approval-persistence transform (its backpressure array now module-private).
 * Guest returns `{}`.
 */
export type DurableStreamTextExtras = {
  toolApproval?: Record<string, ToolApprovalStatus>
  experimental_transform?: StreamTextTransform<ToolSet>
}

/**
 * Stream-onEnd half of the finish handoff, pushed synchronously as data
 * (`captureFinish`). ai@7 `usage` aggregates across ALL steps.
 */
export type StreamFinishFacts = {
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  finishReason: string | undefined
  toolCounts: { totalToolCalls: number; failedToolCalls: number }
}

/** One recorded step's tool activity — the durable-persistence view of it. */
export type DurableStepRecord = {
  stepNumber: number
  toolCalls: ReadonlyArray<{
    toolCallId: string
    toolName: string
    input?: unknown
  }>
  toolResults?: ReadonlyArray<{
    toolCallId: string
    output?: unknown
    isError?: boolean
  }>
}

export type DurableTurnRuntime = {
  /** Observability dimension only — callers MUST NOT branch on it. */
  readonly mode: "durable" | "guest"

  /**
   * Durable-prepare: `prepareGeneration` (approval-response extraction, the
   * regeneration×approvals 400, latest-user-message selection, the Convex
   * argument-validation → 400 mapping after the
   * `durable_prepare_argument_rejected` warn; concurrency-guard errors pass
   * through unmapped). Returns the canonical model history — durable: sanitized
   * server history; guest: sanitized input. One-shot.
   */
  prepare(args: { provider: string }): Promise<MessageAISDK[]>

  /**
   * Binds `ToolFacts` for the stream lifetime; returns the spreadable extras
   * (toolApproval gate + approval-persistence transform). Guest: `{}`. One-shot,
   * before the stream starts; `recordStep` before binding throws.
   */
  streamTextExtras(toolFacts: ToolFacts): DurableStreamTextExtras

  // Write timeline — void = fire-and-forget BY CONTRACT, Promise = await.
  onChunk(chunk: TextStreamPart<ToolSet>): void
  recordStep(step: DurableStepRecord): void
  noteStreamError(errorMessage: string): void
  onStreamAbort(reason: string): Promise<void>

  /** Stream-onEnd half of the finish handoff (sync capture). */
  captureFinish(facts: StreamFinishFacts): void

  /**
   * Envelope identity: durable history + assistant-message-id factory, or guest
   * passthrough of the POST-validation array (why this is a method taking
   * `validatedMessages`, not a construction-time getter).
   */
  uiStreamIdentity(validatedMessages: MessageAISDK[]): {
    originalMessages: UIMessage[]
    generateMessageId?: () => string
  }

  /**
   * Envelope-onEnd terminal write. Internal ordering, load-bearing:
   * allSettled(approvalWritePromises) → flush → markAborted | markCompleted.
   * LOUD-FALLBACK CONTRACT: a completed path without a prior `captureFinish()`
   * emits `durable_finish_handoff_missed` (warn + Sentry) BEFORE falling back to
   * `countToolParts` — the write still lands; the bug no longer hides. May reject
   * on completion-write failure (today's envelope semantics).
   */
  finalize(outcome: {
    responseMessage: UIMessage
    isAborted: boolean
    finishReason?: string
  }): Promise<void>

  /**
   * Legal at ANY phase: pre-prepare (no run → no-op), mid-stream, or after
   * `finalize()` (first-terminal-wins absorbs it). Never throws.
   */
  fail(errorMessage: string): Promise<void>
}

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

/** Serialize an unknown error for a structured warn `_tag` line. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function getStringField(
  value: Record<string, unknown> | null,
  field: string
): string | undefined {
  if (!value) return undefined
  const candidate = value[field]
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined
}

// ---------------------------------------------------------------------------
// Durable snapshot tracker — throttled assistant-snapshot writes.
// ---------------------------------------------------------------------------

type SnapshotPart =
  { type: "text"; text: string } | { type: "reasoning"; text: string }

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
  messageId: Id<"messages">
  order: number
  throttleMs?: number
  /**
   * Injected snapshot persister — defaults to the module `fetchMutation` so the
   * Durable turn runtime can thread its own injected `deps.fetchMutation`
   * through, making snapshot writes mockable without module-level mocking.
   */
  fetchMutation?: typeof defaultFetchMutation
}

export function createDurableSnapshotTracker(
  options: DurableSnapshotTrackerOptions
) {
  const persistSnapshot = options.fetchMutation ?? defaultFetchMutation
  let text = ""
  let reasoning = ""
  let sequence = 0
  let lastWriteAt = 0
  let writeInFlight: Promise<unknown> | null = null
  // Dirtiness is content-versioned, not a boolean: a persist loop re-runs only
  // when a chunk advanced the version past what the last completed write
  // captured. A shared `pending` flag let two overlapping flush() calls (the
  // streamText onAbort and the response-level onEnd both flush on Stop)
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

// ---------------------------------------------------------------------------
// Approval-persistence transform — writes a tool-approval request before the
// approval chunk streams, so the client never renders an approval prompt that
// isn't yet durable.
// ---------------------------------------------------------------------------

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

type RuntimeApprovalPersistenceRunState = {
  runId: Id<"generationRuns">
  assistantMessageId: Id<"messages">
}

type ToolApprovalRequestPersistenceArgs = {
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

type RuntimeApprovalPersistenceTransformOptions = {
  chatId: string
  convexToken: string
  durableRunState: RuntimeApprovalPersistenceRunState
  /**
   * The Tool runtime facts — `source` for the persisted source, `approvalFor`
   * for the decision's `reason`/`riskClass` (which subsume the old
   * `runtimeApprovalByToolName` map threading).
   */
  toolFacts: ToolFacts
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
  toolFacts,
  approvalWritePromises,
  requestId,
  persistApprovalRequest,
}: RuntimeApprovalPersistenceTransformOptions): StreamTextTransform<ToolSet> {
  const persist =
    persistApprovalRequest ??
    ((args: ToolApprovalRequestPersistenceArgs) =>
      defaultFetchMutation(api.chatRuntime.createToolApprovalRequest, args, {
        token: convexToken,
      }))

  return () =>
    new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
      async transform(chunk, controller) {
        if (chunk.type === "tool-approval-request") {
          const toolName = chunk.toolCall.toolName
          const decision = toolFacts.approvalFor(toolName)
          const source = toolFacts.metadata.source(toolName)
          const inputPreview = (() => {
            try {
              return JSON.stringify(chunk.toolCall.input).slice(0, 500)
            } catch {
              return String(chunk.toolCall.input).slice(0, 500)
            }
          })()

          const approvalWrite = (async () =>
            persist({
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
                error: describeError(error),
              })
            )
            throw error
          }
        }

        controller.enqueue(chunk)
      },
    })
}

// ---------------------------------------------------------------------------
// Guest adapter — the null object of durability. Identity passthrough, `{}`
// extras, no-op writes, zero network. "Guest chats run ungated" is structural.
// ---------------------------------------------------------------------------

export function createGuestDurableTurn(
  input: DurableTurnInput
): DurableTurnRuntime {
  return {
    mode: "guest",
    async prepare() {
      return sanitizeModelHistoryMessages(input.messages) as MessageAISDK[]
    },
    streamTextExtras() {
      return {}
    },
    onChunk() {},
    recordStep() {},
    noteStreamError() {},
    async onStreamAbort() {},
    captureFinish() {},
    uiStreamIdentity(validatedMessages) {
      return { originalMessages: validatedMessages }
    },
    async finalize() {},
    async fail() {},
  }
}

// ---------------------------------------------------------------------------
// Convex adapter — the full durable timeline for one authenticated Chat turn.
// ---------------------------------------------------------------------------

export function createConvexDurableTurn(args: {
  input: DurableTurnInput & { convexToken: string }
  deps: DurableTurnDeps
}): DurableTurnRuntime {
  const { input, deps } = args
  const {
    chatId,
    requestId,
    model,
    messages,
    convexToken,
    edit,
    regeneration,
    expectedVisibleMessageCount,
    tailMessageId,
  } = input
  const { fetchMutation } = deps

  // The durable run — assigned once at prepare(), then read by the timeline.
  let runId: Id<"generationRuns"> | null = null
  let assistantMessageId: Id<"messages"> | null = null
  let originalMessages: DurableUiMessage[] = []
  let snapshotTracker: ReturnType<typeof createDurableSnapshotTracker> | null =
    null

  // Stream-lifetime state — bound at streamTextExtras() and the finish handoff.
  let toolFacts: ToolFacts | null = null
  const approvalWritePromises: Promise<unknown>[] = []
  let capturedFinish: StreamFinishFacts | undefined

  // One-shot guards — programming errors, not ops events.
  let prepareCalled = false
  let extrasBound = false

  const markRunAborted = async (reason: string) => {
    if (!runId || !assistantMessageId) return
    try {
      await fetchMutation(
        api.chatRuntime.markGenerationRunAborted,
        {
          runId,
          messageId: assistantMessageId,
          reason,
        },
        { token: convexToken }
      )
    } catch (error) {
      console.warn(
        JSON.stringify({
          _tag: "durable_run_abort_write_failed",
          requestId,
          chatId,
          runId,
          error: describeError(error),
        })
      )
    }
  }

  return {
    mode: "durable",

    async prepare({ provider }) {
      if (prepareCalled) {
        throw new Error(
          "Durable turn runtime: prepare() may only be called once"
        )
      }
      prepareCalled = true

      const approvalResponses = extractApprovalResponses(messages)
      if (regeneration && approvalResponses.length > 0) {
        throw Object.assign(
          new Error("Regeneration cannot continue pending approvals"),
          { statusCode: 400, code: "INVALID_REQUEST" }
        )
      }

      const latestUserMessage =
        edit || regeneration || hasApprovalResponse(messages)
          ? undefined
          : getLatestUserMessage(messages)

      const generation = await fetchMutation(
        api.chatRuntime.prepareGeneration,
        {
          chatId: chatId as Id<"chats">,
          requestId,
          model,
          provider,
          expectedVisibleMessageCount,
          tailMessageId,
          latestUserMessage: latestUserMessage
            ? {
                id: latestUserMessage.id,
                role: "user" as const,
                content: getStringField(
                  getRecord(latestUserMessage as unknown),
                  "content"
                ),
                parts: latestUserMessage.parts,
              }
            : undefined,
          edit,
          regeneration,
          approvalResponses,
        },
        { token: convexToken }
      ).catch((error: unknown) => {
        // `isServerChatId` only rules out local/optimistic prefixes, so a
        // crafted or corrupted id reaches the durable contract here and Convex
        // rejects it with argument validation. That is a request-shape fault:
        // map it to the route's 400 instead of a 500 that leaks Convex error
        // internals. Everything else (concurrency guards, transient failures)
        // passes through unchanged.
        if (isConvexArgumentValidationError(error)) {
          console.warn(
            JSON.stringify({
              _tag: "durable_prepare_argument_rejected",
              requestId,
              chatId,
              error: describeError(error),
            })
          )
          throw Object.assign(
            new Error("Request does not reference a valid durable chat"),
            { statusCode: 400, code: "INVALID_REQUEST" }
          )
        }
        throw error
      })

      const durableMessages = sanitizeModelHistoryMessages(
        toDurableUiMessages(generation.messages)
      ) as DurableUiMessage[]

      runId = generation.runId
      assistantMessageId = generation.assistantMessageId
      originalMessages = durableMessages
      snapshotTracker = createDurableSnapshotTracker({
        convexToken,
        runId: generation.runId,
        messageId: generation.assistantMessageId,
        order: generation.assistantOrder,
        fetchMutation,
      })

      console.log(
        JSON.stringify({
          _tag: "durable_chat_runtime_prepared",
          requestId,
          chatId,
          runId: generation.runId,
          assistantMessageId: generation.assistantMessageId,
          canonicalMessageCount: durableMessages.length,
          approvalResponseCount: approvalResponses.length,
          hasLatestUserMessage: Boolean(latestUserMessage),
          hasRegeneration: Boolean(regeneration),
          targetAssistantMessageId: regeneration?.targetAssistantMessageId,
        })
      )

      return durableMessages as MessageAISDK[]
    },

    streamTextExtras(facts) {
      const currentRunId = runId
      const currentMessageId = assistantMessageId
      if (!currentRunId || !currentMessageId) {
        throw new Error(
          "Durable turn runtime: streamTextExtras() requires a completed prepare()"
        )
      }
      if (extrasBound) {
        throw new Error(
          "Durable turn runtime: streamTextExtras() may only be called once"
        )
      }
      extrasBound = true
      toolFacts = facts

      const extras: DurableStreamTextExtras = {}
      // Call-site approval config (ai@7): the Tool runtime's decisions, durable
      // runs only — guest chats run ungated, matching the pre-v7 wrap-on-durable
      // behavior.
      if (facts.toolApproval) {
        extras.toolApproval = facts.toolApproval
      }
      extras.experimental_transform = createRuntimeApprovalPersistenceTransform(
        {
          chatId,
          convexToken,
          durableRunState: {
            runId: currentRunId,
            assistantMessageId: currentMessageId,
          },
          toolFacts: facts,
          approvalWritePromises,
          requestId,
          persistApprovalRequest: (approvalArgs) =>
            fetchMutation(
              api.chatRuntime.createToolApprovalRequest,
              approvalArgs,
              { token: convexToken }
            ),
        }
      )
      return extras
    },

    onChunk(chunk) {
      snapshotTracker?.onChunk(chunk)
    },

    recordStep({ stepNumber, toolCalls, toolResults }) {
      const currentRunId = runId
      const currentMessageId = assistantMessageId
      const facts = toolFacts
      if (!extrasBound || !facts || !currentRunId || !currentMessageId) {
        throw new Error(
          "Durable turn runtime: recordStep() requires streamTextExtras()"
        )
      }

      const invocations: ToolInvocationForPersistence[] = toolCalls.map(
        (call) => {
          const result = toolResults?.find(
            (candidate) => candidate.toolCallId === call.toolCallId
          )
          const isError = result ? Boolean(result.isError) : false
          const approvalDecision = facts.approvalFor(call.toolName)
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            source: facts.metadata.source(call.toolName),
            input: call.input,
            output: result?.output,
            error: isError
              ? String(result?.output ?? "Tool failed")
              : undefined,
            status: result
              ? isError
                ? "failed"
                : "completed"
              : approvalDecision?.needsApproval
                ? "pending_approval"
                : "called",
          }
        }
      )

      void fetchMutation(
        api.chatRuntime.recordToolInvocations,
        {
          runId: currentRunId,
          messageId: currentMessageId,
          stepNumber,
          invocations,
        },
        { token: convexToken }
      ).catch((error: unknown) => {
        console.warn(
          JSON.stringify({
            _tag: "canonical_tool_invocation_write_failed",
            requestId,
            chatId,
            runId: currentRunId,
            error: describeError(error),
          })
        )
      })
    },

    noteStreamError(errorMessage) {
      const currentRunId = runId
      const currentMessageId = assistantMessageId
      if (!currentRunId || !currentMessageId) return
      void fetchMutation(
        api.chatRuntime.markGenerationRunFailed,
        {
          runId: currentRunId,
          messageId: currentMessageId,
          error: errorMessage,
        },
        { token: convexToken }
      ).catch((error: unknown) => {
        console.warn(
          JSON.stringify({
            _tag: "durable_run_failed_write_failed",
            requestId,
            chatId,
            runId: currentRunId,
            error: describeError(error),
          })
        )
      })
    },

    async onStreamAbort(reason) {
      await snapshotTracker?.flush().catch(() => {})
      await markRunAborted(reason)
    },

    captureFinish(facts) {
      capturedFinish = facts
    },

    uiStreamIdentity() {
      const messageId = assistantMessageId
      return messageId
        ? { originalMessages, generateMessageId: () => messageId }
        : { originalMessages }
    },

    async finalize({ responseMessage, isAborted, finishReason }) {
      await Promise.allSettled(approvalWritePromises)
      await snapshotTracker?.flush().catch(() => {})

      if (isAborted) {
        await markRunAborted("ui message stream aborted")
        return
      }

      const currentRunId = runId
      const currentMessageId = assistantMessageId
      if (!currentRunId || !currentMessageId) return

      let toolCounts = capturedFinish?.toolCounts
      if (!toolCounts) {
        // The stream-onEnd half of the handoff never ran — the failure mode
        // ADR-0006 named. Land the completion write anyway (part-counted), but
        // LOUDLY so the bug surfaces instead of hiding behind the fallback.
        console.warn(
          JSON.stringify({
            _tag: "durable_finish_handoff_missed",
            requestId,
            chatId,
            runId: currentRunId,
          })
        )
        Sentry.captureMessage("durable_finish_handoff_missed", {
          level: "warning",
        })
        toolCounts = countToolParts(responseMessage)
      }

      await fetchMutation(
        api.chatRuntime.markGenerationRunCompleted,
        {
          runId: currentRunId,
          messageId: currentMessageId,
          content: getFinalAssistantText(responseMessage),
          parts: responseMessage.parts,
          metadata: projectPersistedMessageMetadata(responseMessage.metadata),
          finishReason: capturedFinish?.finishReason ?? finishReason,
          usage: capturedFinish?.usage,
          totalToolCalls: toolCounts.totalToolCalls,
          failedToolCalls: toolCounts.failedToolCalls,
        },
        { token: convexToken }
      )
    },

    async fail(errorMessage) {
      const currentRunId = runId
      const currentMessageId = assistantMessageId
      if (!currentRunId || !currentMessageId) return
      await fetchMutation(
        api.chatRuntime.markGenerationRunFailed,
        {
          runId: currentRunId,
          messageId: currentMessageId,
          error: errorMessage,
        },
        { token: convexToken }
      ).catch((writeError: unknown) => {
        console.warn(
          JSON.stringify({
            _tag: "durable_run_failed_write_failed",
            requestId,
            chatId,
            runId: currentRunId,
            error: describeError(writeError),
          })
        )
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Selecting factory — sync, pure. Internalizes `isDurableConvexChat`; returns
// the Convex adapter or the inert guest adapter. The caller never asks "is this
// turn durable"; the convex token crosses here, once.
// ---------------------------------------------------------------------------

export function createDurableTurnRuntime(args: {
  input: DurableTurnInput
  deps: DurableTurnDeps
}): DurableTurnRuntime {
  const { input, deps } = args
  if (
    isDurableConvexChat({
      isAuthenticated: input.isAuthenticated,
      convexToken: input.convexToken,
      chatId: input.chatId,
    }) &&
    input.convexToken
  ) {
    return createConvexDurableTurn({
      input: { ...input, convexToken: input.convexToken },
      deps,
    })
  }
  return createGuestDurableTurn(input)
}
