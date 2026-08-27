import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import {
  deriveAssistantTurnView,
  type AssistantTurnView,
} from "@/lib/chat-messages/assistant-turn"
import { resolveTurnBranch } from "@/lib/chat-messages/branch"
import {
  isDurableMessageStatus,
  type DurableMessageStatus,
} from "@/lib/chat-messages/durable-contract"
import { getFinishReason } from "@/lib/chat-messages/metadata"
import { extractTextFromMessageParts } from "@/lib/chat-messages/parts"
import type { TurnRowModel } from "@/lib/chat-messages/turn-row"
import type { EditTurnResult } from "@/lib/chat-turn/chat-turn-controller"
import { cn } from "@/lib/utils"
import { UIMessage as MessageType } from "@ai-sdk/react"
import {
  Fragment,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react"
import {
  ConversationTimestamp,
  deriveConversationTimestampHeaders,
} from "./conversation-timestamp"
import { Message } from "./message"
import {
  THREAD_GUTTER_VARS,
  THREAD_MAXWIDTH_VARS,
  TURN_SCROLL_MARGIN_BOTTOM,
} from "./thread-bounds"
import {
  CHATGPT_TURN_INTERSECTION_EXPERIMENT,
  estimateTurnPlaceholderHeight,
  isTurnAlwaysRendered,
  ThreadScrollEdge,
  TURN_ESTIMATE_DESKTOP_CHARACTERS_PER_LINE,
  TURN_ESTIMATE_MOBILE_CHARACTERS_PER_LINE,
  useConversationTurnVirtualization,
  useSubmitTurnScrollRef,
  type TurnIntersectionObserver,
} from "./thread-scroll"
import type { ThreadScrollTarget } from "./thread-scroll-target"
import {
  isGenerationActive,
  PENDING_ACTIVITY_TURN_ID,
  shouldRenderPendingAssistantTurn,
} from "./use-activity-panel"

type MessageRenderStatus = DurableMessageStatus | "ready" | "error"

const subscribeToBrowser = () => () => undefined
const getBrowserSnapshot = () => true
const getServerSnapshot = () => false

function useContentVisibilitySupport() {
  const browser = useSyncExternalStore(
    subscribeToBrowser,
    getBrowserSnapshot,
    getServerSnapshot
  )
  return (
    browser &&
    typeof CSS !== "undefined" &&
    CSS.supports("content-visibility: auto")
  )
}

type ConversationMessage = MessageType & {
  createdAt?: Date
}

function isMessageRenderStatus(value: unknown): value is MessageRenderStatus {
  return value === "ready" || value === "error" || isDurableMessageStatus(value)
}

// v6 helper: Extract text content from all text parts in order.
// Tool-enabled responses can interleave multiple assistant text parts across
// steps; using only the first part makes responses appear truncated.
function getMessageText(message: MessageType): string {
  return extractTextFromMessageParts(message.parts)
}

function getMessageTextParts(message: MessageType): string[] {
  const textParts: string[] = []
  for (const part of message.parts ?? []) {
    if (part.type === "text" && part.text.length > 0) textParts.push(part.text)
  }
  return textParts
}

/**
 * Asset-bearing turns are always rendered for real so scrolling to them never
 * jumps. The reference detector (conv.beauty.js `aZn`/`sZn`) is
 * `(metadata.attachments?.length ?? 0) > 0 || parts.some(isAssetPointer)` over
 * a content-type set (Image/ImageAssetPointer/Audio/Video/...). In this data
 * model both user attachments and generated media arrive as `file` parts, so
 * one part-type check is the whole translation.
 */
function hasTurnAssetContent(message: MessageType): boolean {
  return message.parts?.some((part) => part.type === "file") ?? false
}

// Extract file attachments from parts array (user rows; assistant rows render
// no attachments)
function getMessageAttachments(
  message: MessageType
): Array<{ name: string; contentType: string; url: string }> | undefined {
  const fileParts = message.parts?.filter((p) => p.type === "file")
  if (!fileParts || fileParts.length === 0) return undefined
  return fileParts.map((p) => ({
    name: (p as { filename?: string }).filename || "file",
    contentType:
      (p as { mediaType?: string }).mediaType || "application/octet-stream",
    url: (p as { url?: string }).url || "",
  }))
}

/**
 * TurnRow — the stable section wrapper shared by mapped messages and the
 * pending-assistant placeholder. Pending and real assistant content reconcile
 * through this same DOM node; only its data identity and contents update.
 *
 * Two DOM shapes, mirroring the reference's two turn lists (virt.beauty.js
 * `EagerConversationTurns`/`VirtualizedConversationTurns`): the virtualized
 * shape keeps an outer wrapper div carrying `data-is-intersecting` and the
 * placeholder height; the eager shape (the shipped default arm) renders the
 * section directly with no wrapper — the section itself carries
 * `data-turn-id-container` and the center observation attaches to it, exactly
 * as the reference `Fkn` section does.
 */
function TurnRow({
  className,
  dataTurn,
  dataTurnId,
  dataTestId,
  beforeTurn,
  alwaysShow,
  contentVisibility = false,
  centerIntersectionObserver,
  eager = false,
  estimatedTextParts,
  forceRender = false,
  hasDisplayableContent = true,
  hasTurnAssets = false,
  onRenderIntersectingChange,
  renderIntersectionObserver,
  onCenterIntersectionChange,
  scrollOnSubmit = false,
  verticalPadding = "none",
  children,
}: {
  className: string
  dataTurn: string
  dataTurnId: string
  dataTestId?: string
  beforeTurn?: ReactNode
  alwaysShow: boolean
  contentVisibility?: boolean
  centerIntersectionObserver: TurnIntersectionObserver
  /** Render the reference's wrapper-free eager shape. */
  eager?: boolean
  estimatedTextParts: readonly string[]
  forceRender?: boolean
  hasDisplayableContent?: boolean
  hasTurnAssets?: boolean
  onRenderIntersectingChange: (
    turnId: string,
    intersecting: boolean,
    entry?: IntersectionObserverEntry
  ) => void
  renderIntersectionObserver: TurnIntersectionObserver
  onCenterIntersectionChange?: (turnId: string, intersecting: boolean) => void
  scrollOnSubmit?: boolean
  verticalPadding?: "none" | "first" | "large" | "last"
  children: ReactNode
}) {
  const compactEstimate = useBreakpoint(640)
  const [renderIntersecting, setRenderIntersecting] = useState(false)
  const turnRef = useRef<HTMLDivElement | null>(null)
  const wasRenderIntersectingRef = useRef(false)
  const charactersPerLine = compactEstimate
    ? TURN_ESTIMATE_MOBILE_CHARACTERS_PER_LINE
    : TURN_ESTIMATE_DESKTOP_CHARACTERS_PER_LINE
  const shouldAlwaysRender = alwaysShow || hasTurnAssets
  const shouldRender = shouldAlwaysRender || renderIntersecting || forceRender
  const shouldRenderContent = hasDisplayableContent && shouldRender
  const isIntersecting = shouldAlwaysRender || renderIntersecting
  const estimatedHeight = useMemo(
    () =>
      shouldRender || !hasDisplayableContent
        ? null
        : estimateTurnPlaceholderHeight(estimatedTextParts, charactersPerLine),
    [charactersPerLine, estimatedTextParts, hasDisplayableContent, shouldRender]
  )

  const rememberHeight = useCallback((height: number) => {
    if (height > 10) {
      turnRef.current?.style.setProperty("--last-known-height", `${height}px`)
    }
  }, [])

  useBrowserLayoutEffect(() => {
    if (eager || !alwaysShow || renderIntersecting) return
    wasRenderIntersectingRef.current = true
    setRenderIntersecting(true)
    onRenderIntersectingChange(dataTurnId, true)
  }, [
    alwaysShow,
    dataTurnId,
    eager,
    onRenderIntersectingChange,
    renderIntersecting,
  ])

  useBrowserLayoutEffect(() => {
    if (!forceRender || renderIntersecting || shouldAlwaysRender) return
    const turn = turnRef.current
    if (turn) rememberHeight(turn.getBoundingClientRect().height)
  }, [forceRender, rememberHeight, renderIntersecting, shouldAlwaysRender])

  const turnRefCallback = useCallback(
    (turn: HTMLElement | null) => {
      turnRef.current = turn as HTMLDivElement | null
      if (!turn) return
      const cleanups: Array<() => void> = []

      if (!shouldAlwaysRender) {
        cleanups.push(
          renderIntersectionObserver.observe(turn, (intersecting, entry) => {
            const wasIntersecting = wasRenderIntersectingRef.current
            if (wasIntersecting && !intersecting && entry) {
              rememberHeight(entry.boundingClientRect.height)
            }
            if (wasIntersecting === intersecting) return
            wasRenderIntersectingRef.current = intersecting
            onRenderIntersectingChange(dataTurnId, intersecting, entry)
            setRenderIntersecting(intersecting)
          })
        )
      }

      if (onCenterIntersectionChange) {
        cleanups.push(
          centerIntersectionObserver.observe(turn, (intersecting) => {
            onCenterIntersectionChange(dataTurnId, intersecting)
          })
        )
      }

      return () => {
        for (const cleanup of cleanups) cleanup()
        onCenterIntersectionChange?.(dataTurnId, false)
        if (turnRef.current === turn) turnRef.current = null
      }
    },
    [
      centerIntersectionObserver,
      dataTurnId,
      onCenterIntersectionChange,
      onRenderIntersectingChange,
      rememberHeight,
      renderIntersectionObserver,
      shouldAlwaysRender,
    ]
  )
  const submitScrollRef = useSubmitTurnScrollRef(scrollOnSubmit)
  // Eager sections own their observation directly: the reference `Fkn` runs the
  // center (table-of-contents) observer against the section node in both arms,
  // and the eager arm has no wrapper to host it.
  const eagerSectionRef = useCallback(
    (section: HTMLElement | null) => {
      const submitCleanup = submitScrollRef(section)
      const centerCleanup =
        section && onCenterIntersectionChange
          ? centerIntersectionObserver.observe(section, (intersecting) =>
              onCenterIntersectionChange(dataTurnId, intersecting)
            )
          : undefined
      return () => {
        submitCleanup?.()
        if (centerCleanup) {
          centerCleanup()
          onCenterIntersectionChange?.(dataTurnId, false)
        }
      }
    },
    [
      centerIntersectionObserver,
      dataTurnId,
      onCenterIntersectionChange,
      submitScrollRef,
    ]
  )
  const placeholderStyle:
    | (CSSProperties & {
        "--estimated-turn-height"?: string
      })
    | undefined = estimatedHeight
    ? { "--estimated-turn-height": `${estimatedHeight}px` }
    : undefined

  const turnContent = shouldRenderContent ? (
    <>
      {beforeTurn}
      <section
        ref={eager ? eagerSectionRef : submitScrollRef}
        className={cn(
          "text-foreground w-full focus:outline-none has-data-writing-block:pointer-events-none [&:has([data-writing-block])>*]:pointer-events-auto",
          contentVisibility &&
            "[content-visibility:auto] has-[[data-dotball-loading-indicator]]:[content-visibility:visible]! supports-[content-visibility:auto]:[contain-intrinsic-size:auto_100lvh]",
          className
        )}
        data-turn-id-container={dataTurnId}
        data-turn={dataTurn}
        data-turn-id={dataTurnId}
        data-testid={dataTestId}
        dir="auto"
      >
        <h4 className="sr-only select-none">
          {dataTurn === "user" ? "You said:" : "ChatGPT said:"}
        </h4>
        <div
          className={cn(
            `mx-auto my-auto px-[var(--thread-content-margin,1rem)] text-base ${THREAD_GUTTER_VARS}`,
            verticalPadding === "first" && "pt-3",
            verticalPadding === "large" && "pt-12",
            verticalPadding === "last" && "pb-8"
          )}
        >
          <div
            data-conversation-screenshot-content=""
            className={`group/turn-messages relative mx-auto flex w-full max-w-[var(--thread-content-max-width,40rem)] min-w-0 flex-1 flex-col focus-visible:outline-hidden ${THREAD_MAXWIDTH_VARS} ${dataTurn === "assistant" ? "agent-turn" : ""}`}
          >
            {children}
          </div>
          {dataTurn === "assistant" ? (
            <div
              data-conversation-screenshot-content=""
              className={`mx-auto max-w-[var(--thread-content-max-width,40rem)] flex-1 ${THREAD_MAXWIDTH_VARS}`}
            >
              <div />
            </div>
          ) : null}
        </div>
      </section>
    </>
  ) : null

  // The eager shape drops the wrapper entirely (reference `fGn` → `L4`): no
  // `data-is-intersecting`, no placeholder height — a hidden turn renders
  // nothing at all.
  if (eager) return turnContent

  return (
    <div
      ref={
        shouldAlwaysRender && !onCenterIntersectionChange
          ? undefined
          : turnRefCallback
      }
      className={cn(
        hasDisplayableContent &&
          !shouldRender &&
          "h-[var(--last-known-height,var(--estimated-turn-height,50vh))] min-h-14"
      )}
      data-is-intersecting={isIntersecting}
      data-turn-id-container={dataTurnId}
      style={placeholderStyle}
    >
      {turnContent}
    </div>
  )
}

type ConversationRenderRow =
  | { kind: "root"; key: "client-created-root" }
  | {
      kind: "message"
      key: string
      message: ConversationMessage
      index: number
    }
  | { kind: "pending"; key: string; index: number }

function assistantTurnRowKey(userMessageId: string): string {
  return `assistant-turn:${userMessageId}`
}

function messageTurnRowKey(
  messages: ConversationMessage[],
  index: number
): string {
  const message = messages[index]
  const previousMessage = messages[index - 1]

  if (message.role === "assistant" && previousMessage?.role === "user") {
    return assistantTurnRowKey(previousMessage.id)
  }

  return `message:${message.id}`
}

function messageTurnRowId(
  messages: ConversationMessage[],
  index: number
): string {
  const message = messages[index]
  return message.role === "assistant"
    ? messageTurnRowKey(messages, index)
    : message.id
}

function renderRowTurnId(row: ConversationRenderRow): string {
  return row.kind === "root" || row.kind === "pending"
    ? row.key
    : row.message.role === "assistant"
      ? row.key
      : row.message.id
}

type ConversationProps = {
  messages: ConversationMessage[]
  /** Stable observation time for one render; injectable by deterministic
   * lifecycle tests without mocking the global clock. */
  now?: Date
  status?: "streaming" | "ready" | "submitted" | "error"
  isSubmitting?: boolean
  /** Scopes the scroll lifecycle (load restore, pinning) to one conversation. */
  chatId?: string | null
  /** True when this conversation was started in this session — the scroll
   * position came from send-time pinning, so the load restore must not run. */
  hasSentFirstMessage?: boolean
  onEdit: (
    id: string,
    newText: string
  ) => Promise<EditTurnResult | void> | EditTurnResult | void
  onReload: (messageId: string) => void
  retryModelId?: string
  onQuote?: (text: string, messageId: string) => void
  onSelectBranch?: (messageId: string) => void
  isDurableChat?: boolean
  lastFinishReason?: string
  /** Message deep-link value from the route. The two final-turn sentinels
   * target the final assistant turn rather than a particular message node. */
  scrollToMessageId?: string | null
  /** Optional table-of-contents observer. Its center-band state is separate
   * from the outer turn's render/virtualization intersection. */
  onCenterIntersectionChange?: (turnId: string, intersecting: boolean) => void
}

export function shouldUseAssistantContentVisibility({
  supported,
  isUser,
  audioSurfaceActive = false,
  hasHtmlWidget = false,
  scrollToMessageId,
  experimentEnabled = CHATGPT_TURN_INTERSECTION_EXPERIMENT.enabled,
}: {
  supported: boolean
  isUser: boolean
  audioSurfaceActive?: boolean
  hasHtmlWidget?: boolean
  scrollToMessageId?: string | null
  experimentEnabled?: boolean
}) {
  return (
    supported &&
    !isUser &&
    !audioSurfaceActive &&
    (scrollToMessageId == null || scrollToMessageId === "finalAgentTurn") &&
    !hasHtmlWidget &&
    !experimentEnabled
  )
}

function resolveConversationScrollTarget(
  messages: ConversationMessage[],
  scrollToMessageId: string | null | undefined
): ThreadScrollTarget | null {
  if (!scrollToMessageId) return null

  if (
    scrollToMessageId === "finalAgentTurn" ||
    scrollToMessageId === "finalAgentTurnStart"
  ) {
    let index = messages.length - 1
    while (index >= 0 && messages[index]?.role !== "assistant") index -= 1
    if (index === -1) return null
    return { turnId: messageTurnRowId(messages, index) }
  }

  const index = messages.findIndex(
    (message) => message.id === scrollToMessageId
  )
  if (index === -1) return null
  return {
    turnId: messageTurnRowId(messages, index),
    messageId: scrollToMessageId,
  }
}

/** The pending placeholder's view: no parts yet, generation submitted. Module
 * constant so its metadata identity is stable across renders (memo-friendly). */
const PENDING_TURN_VIEW: AssistantTurnView = deriveAssistantTurnView(
  { parts: [] },
  "submitted"
)

export function Conversation({
  messages,
  now = new Date(),
  status = "ready",
  isSubmitting = false,
  chatId = null,
  hasSentFirstMessage = false,
  onEdit,
  onReload,
  retryModelId,
  onQuote,
  onSelectBranch,
  isDurableChat,
  lastFinishReason,
  scrollToMessageId,
  onCenterIntersectionChange,
}: ConversationProps) {
  const contentVisibilitySupported = useContentVisibilitySupport()
  const scrollTarget = resolveConversationScrollTarget(
    messages,
    scrollToMessageId
  )
  // The reference selects Eager vs Virtualized turns once at mount:
  // `J = !deepLinkAtMount && experimentGate()`. A finalAgentTurnStart arrival
  // or a disabled gate renders the whole thread eagerly.
  const [renderAllTurns] = useState(
    () =>
      scrollToMessageId === "finalAgentTurnStart" ||
      !CHATGPT_TURN_INTERSECTION_EXPERIMENT.enabled
  )
  const virtualization = useConversationTurnVirtualization(scrollTarget?.turnId)
  if (!messages || messages.length === 0)
    return <div className="w-full flex-1"></div>

  const generationActive = isGenerationActive(status, isSubmitting)
  const lastMessage = messages[messages.length - 1]
  const previousMessage = messages[messages.length - 2]
  const hasPendingAssistantTurn = shouldRenderPendingAssistantTurn({
    messages,
    status,
    isSubmitting,
  })
  // Persistence can insert the real assistant shell before its first stream
  // part. Keep that empty shell out of the rendered path so the pending row
  // remains the single 32px owner until content can replace it atomically.
  const renderedMessages =
    hasPendingAssistantTurn && lastMessage?.role === "assistant"
      ? messages.slice(0, -1)
      : messages
  // The active final user turn owns submit placement. Branch switches and load
  // hydration never satisfy this, so they never issue a scroll command.
  const submitScrollTurnId = !generationActive
    ? null
    : lastMessage?.role === "user"
      ? lastMessage.id
      : lastMessage?.role === "assistant" && previousMessage?.role === "user"
        ? previousMessage.id
        : null
  const timestampHeaders = deriveConversationTimestampHeaders(
    renderedMessages,
    now
  )
  const renderRows: ConversationRenderRow[] = [
    { kind: "root", key: "client-created-root" },
    ...renderedMessages.map((message, index) => ({
      kind: "message" as const,
      key: messageTurnRowKey(renderedMessages, index),
      message,
      index,
    })),
  ]
  // Local chat has no audio-paragen or HTML SDK widget surface, so those two
  // recovered guards are vacuously false.
  const contentVisibilityEnabled = shouldUseAssistantContentVisibility({
    supported: contentVisibilitySupported,
    isUser: false,
    scrollToMessageId,
  })

  if (hasPendingAssistantTurn) {
    const activeUserMessage =
      lastMessage?.role === "user"
        ? lastMessage
        : lastMessage?.role === "assistant" && previousMessage?.role === "user"
          ? previousMessage
          : undefined

    renderRows.push({
      kind: "pending",
      key: assistantTurnRowKey(
        activeUserMessage?.id ?? PENDING_ACTIVITY_TURN_ID
      ),
      index: renderedMessages.length,
    })
  }

  const activeTurnIndex = scrollTarget
    ? renderRows.findIndex(
        (row) => renderRowTurnId(row) === scrollTarget.turnId
      )
    : -1

  return (
    <div className="relative -mb-(--composer-overlap-px) flex w-full grow basis-auto flex-col pb-(--composer-overlap-px) [--composer-overlap-px:28px]">
      <div className="keyboard-open:pb-[calc(var(--composer-height,100px)+var(--screen-keyboard-height,0))] flex w-full flex-col text-sm">
        <span ref={virtualization.markerRef} style={{ display: "none" }} />
        {renderRows.map((row, renderIndex) => {
          const rowTurnId = renderRowTurnId(row)
          const alwaysShow =
            renderAllTurns ||
            isTurnAlwaysRendered(
              renderIndex,
              renderRows.length,
              activeTurnIndex
            )
          const forceRender = rowTurnId === scrollTarget?.turnId
          if (row.kind === "root") {
            return (
              <TurnRow
                key={row.key}
                className=""
                dataTurn="assistant"
                dataTurnId={rowTurnId}
                alwaysShow={alwaysShow}
                eager={renderAllTurns}
                centerIntersectionObserver={
                  virtualization.centerIntersectionObserver
                }
                estimatedTextParts={[]}
                forceRender={false}
                hasDisplayableContent={false}
                onRenderIntersectingChange={virtualization.onIntersectingChange}
                renderIntersectionObserver={
                  virtualization.renderIntersectionObserver
                }
              >
                {null}
              </TurnRow>
            )
          }
          if (row.kind === "pending") {
            return (
              <Fragment key={row.key}>
                <TurnRow
                  key="turn"
                  className={cn(
                    "scroll-mt-[calc(var(--header-height)+min(200px,max(70px,20svh)))]",
                    TURN_SCROLL_MARGIN_BOTTOM
                  )}
                  dataTurn="assistant"
                  dataTurnId={rowTurnId}
                  dataTestId={`conversation-turn-${row.index + 1}`}
                  alwaysShow={alwaysShow}
                  eager={renderAllTurns}
                  centerIntersectionObserver={
                    virtualization.centerIntersectionObserver
                  }
                  contentVisibility={contentVisibilityEnabled}
                  estimatedTextParts={[]}
                  forceRender={forceRender}
                  onCenterIntersectionChange={onCenterIntersectionChange}
                  onRenderIntersectingChange={
                    virtualization.onIntersectingChange
                  }
                  renderIntersectionObserver={
                    virtualization.renderIntersectionObserver
                  }
                  verticalPadding="last"
                >
                  <Message
                    model={{
                      kind: "assistant",
                      id: PENDING_ACTIVITY_TURN_ID,
                      text: "",
                      isLast: true,
                      view: PENDING_TURN_VIEW,
                      retryModelId,
                      status: "submitted",
                      isDurableChat,
                    }}
                    onEdit={onEdit}
                    onReload={undefined}
                    onSelectBranch={onSelectBranch}
                    onQuote={onQuote}
                  />
                </TurnRow>
              </Fragment>
            )
          }

          const { message, index } = row
          const isLast =
            index === renderedMessages.length - 1 &&
            !hasPendingAssistantTurn &&
            status !== "submitted"
          // The reference reserves the 32px turn tail on the LAST turn only; settled
          // older turns end at their action row (verified live 2026-07-11).
          const isLastTurnRow =
            index === renderedMessages.length - 1 && !hasPendingAssistantTurn
          const isAssistant = message.role === "assistant"
          const isUser = message.role === "user"

          // Branch nav always anchors on the user message (the turn): show the
          // user's own edit branch, or — when the prompt itself wasn't edited —
          // the response's regenerate branch. Assistant messages never render the
          // control; selecting a response sibling still works because the branch
          // descriptor carries the assistant sibling ids.
          const turnBranch = resolveTurnBranch(
            message,
            renderedMessages[index + 1]
          )
          const durableStatus = (message as { status?: string }).status
          // Durable status wins only when it asserts a settled/paused OUTCOME
          // (aborted/failed/awaiting_approval). Durable LIVE statuses
          // (submitted/streaming) are deliberately ignored: after a Stop or a
          // dropped stream the server run can lag its terminal transition, and
          // adopting its stale "streaming" here resurrected live loaders on a
          // turn whose stream this client already knows is over. The client's
          // own stream status is authoritative for liveness on the last turn;
          // older turns always render settled.
          const messageStatus: MessageRenderStatus =
            isMessageRenderStatus(durableStatus) &&
            (durableStatus === "aborted" ||
              durableStatus === "failed" ||
              durableStatus === "awaiting_approval")
              ? durableStatus
              : isLast
                ? status
                : "ready"

          let rowModel: TurnRowModel
          if (message.role === "assistant") {
            // The single per-render derivation of everything the assistant row
            // renders (see CONTEXT.md "Assistant turn view"). Derived fresh each
            // render — the AI SDK mutates part objects in place during streaming,
            // so this must never be memoized by message reference.
            const view = deriveAssistantTurnView(
              message,
              isLast ? status : "ready"
            )

            rowModel = {
              kind: "assistant",
              id: message.id,
              text: view.text,
              view,
              isLast,
              retryModelId,
              retryDisabled: generationActive,
              status: messageStatus,
              isDurableChat,
              finishReason:
                getFinishReason(message.metadata) ??
                (isLast ? lastFinishReason : undefined),
            }
          } else if (message.role === "user") {
            rowModel = {
              kind: "user",
              id: message.id,
              text: getMessageText(message),
              attachments: getMessageAttachments(message),
              branch: turnBranch,
              isDurableChat,
            }
          } else {
            rowModel = {
              kind: "unsupported",
              id: message.id,
              text: getMessageText(message),
              isDurableChat,
            }
          }

          const messageContent = (
            <Message
              model={rowModel}
              onEdit={onEdit}
              onReload={onReload}
              onSelectBranch={onSelectBranch}
              onQuote={onQuote}
            />
          )

          const timestampHeader = timestampHeaders[index]

          return (
            <Fragment key={row.key}>
              <TurnRow
                key="turn"
                className={cn(
                  TURN_SCROLL_MARGIN_BOTTOM,
                  isUser &&
                    "scroll-mt-[var(--sticky-padding-top,var(--spacing-app-header))]",
                  isAssistant &&
                    "scroll-mt-[calc(var(--header-height)+min(200px,max(70px,20svh)))]"
                )}
                dataTurn={message.role}
                dataTurnId={rowTurnId}
                dataTestId={`conversation-turn-${index + 1}`}
                alwaysShow={alwaysShow}
                eager={renderAllTurns}
                centerIntersectionObserver={
                  virtualization.centerIntersectionObserver
                }
                contentVisibility={isAssistant && contentVisibilityEnabled}
                estimatedTextParts={getMessageTextParts(message)}
                forceRender={forceRender}
                hasTurnAssets={hasTurnAssetContent(message)}
                onCenterIntersectionChange={onCenterIntersectionChange}
                onRenderIntersectingChange={virtualization.onIntersectingChange}
                renderIntersectionObserver={
                  virtualization.renderIntersectionObserver
                }
                beforeTurn={
                  timestampHeader ? (
                    <ConversationTimestamp header={timestampHeader} now={now} />
                  ) : undefined
                }
                scrollOnSubmit={isUser && message.id === submitScrollTurnId}
                verticalPadding={
                  index === 0
                    ? "first"
                    : isUser
                      ? "large"
                      : isLastTurnRow
                        ? "last"
                        : "none"
                }
              >
                {messageContent}
              </TurnRow>
            </Fragment>
          )
        })}
        <ThreadScrollEdge
          chatId={chatId}
          streamActive={generationActive}
          hydrated={messages.length > 0}
          freshChat={hasSentFirstMessage}
          scrollTarget={scrollTarget}
          deepLink={scrollToMessageId != null}
        />
      </div>
    </div>
  )
}
