import { Icon } from "@/components/ui/icon"
import {
  Loader,
  StreamingCaret,
  type StreamingIndicatorVariant,
} from "@/components/ui/loader"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ui/message"
import {
  Reasoning,
  ReasoningContent,
  ReasoningLabel,
} from "@/components/ui/reasoning"
import { SystemMessage } from "@/components/ui/system-message"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { cn } from "@/lib/utils"
import type { UIMessage as MessageAISDK } from "@ai-sdk/react"
import { RiCheckLine, RiFileCopyLine, RiRefreshLine } from "@remixicon/react"
import type { ToolUIPart } from "ai"
import { getStaticToolName, isStaticToolUIPart } from "ai"
import { useCallback, useRef, useState } from "react"
import { getSources } from "./get-sources"
import { QuoteButton } from "./quote-button"
import { SearchImages } from "./search-images"
import { SourcesList } from "./sources-list"
import { ToolInvocation } from "./tool-invocation"
import { useLoadingState } from "./use-loading-state"
import { useReasoningPhase } from "./use-reasoning-phase"
import { useAssistantMessageSelection } from "./useAssistantMessageSelection"

type MessageAssistantProps = {
  children: string
  isLast?: boolean
  copied?: boolean
  copyToClipboard?: () => void
  onReload?: () => void
  onStop?: () => void
  parts?: MessageAISDK["parts"]
  metadata?: Record<string, unknown>
  status?: "streaming" | "ready" | "submitted" | "error"
  className?: string
  messageId: string
  onQuote?: (text: string, messageId: string) => void
  finishReason?: string
}

const STREAMING_INDICATOR_VARIANT: StreamingIndicatorVariant = "caret"

function formatToolProgressLabel(toolName: string): string {
  switch (toolName) {
    case "web_search":
    case "google_search":
      return "Searching the web"
    case "imageGeneration":
    case "image_generation":
      return "Generating image"
    default: {
      const readableName = toolName
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .trim()
      const normalized =
        readableName.length > 0
          ? readableName.charAt(0).toUpperCase() + readableName.slice(1)
          : "Running tool"
      return `Running ${normalized}`
    }
  }
}

export function MessageAssistant({
  children,
  isLast,
  copied,
  copyToClipboard,
  onReload,
  onStop,
  parts,
  metadata,
  status,
  className,
  messageId,
  onQuote,
  finishReason,
}: MessageAssistantProps) {
  const { preferences } = useUserPreferences()
  const sources = getSources(parts || [])

  // v6: Filter tool parts using official helper
  const toolInvocationParts = parts?.filter((part): part is ToolUIPart =>
    isStaticToolUIPart(part)
  )

  const contentNullOrEmpty = children === null || children === ""
  const isLastStreaming = status === "streaming" && isLast
  const hasContent = !contentNullOrEmpty

  // Unified reasoning phase hook
  const persistedDurationMs =
    typeof metadata?.reasoningDurationMs === "number"
      ? metadata.reasoningDurationMs
      : undefined
  const {
    phase: reasoningPhase,
    reasoningText,
    durationSeconds,
    isReasoningStreaming,
    isOpaqueReasoning,
  } = useReasoningPhase({
    parts,
    status: status ?? "ready",
    isLast: isLast ?? false,
    persistedDurationMs,
  })

  // Type for image search results
  type ImageResult = { title: string; imageUrl: string; sourceUrl: string }

  // v6: Use flat properties and official helper for tool name
  const searchImageResults: ImageResult[] =
    parts
      ?.filter(
        (part): part is ToolUIPart =>
          isStaticToolUIPart(part) &&
          part.state === "output-available" &&
          getStaticToolName(part) === "imageSearch" &&
          (part.output as { content?: Array<{ type: string }> })?.content?.[0]
            ?.type === "images"
      )
      .flatMap((part) => {
        const output = part.output as {
          content?: Array<{ type: string; results?: ImageResult[] }>
        }
        return output?.content?.[0]?.results ?? []
      }) ?? []

  const {
    showDots: showStreamingLoader,
    showToolProgress,
    showImageGenProgress,
    activeToolNames,
  } = useLoadingState({
    status: status ?? "ready",
    isLast: isLast ?? false,
    parts,
    contentNullOrEmpty,
    showToolInvocations: preferences.showToolInvocations,
  })

  const messageRef = useRef<HTMLDivElement>(null)
  const { selectionInfo, clearSelection } = useAssistantMessageSelection(
    messageRef,
    true
  )
  const handleQuoteBtnClick = useCallback(() => {
    if (selectionInfo && onQuote) {
      onQuote(selectionInfo.text, selectionInfo.messageId)
      clearSelection()
    }
  }, [selectionInfo, onQuote, clearSelection])

  const [contentCaretPhase, setContentCaretPhase] = useState<
    "hidden" | "visible" | "fading"
  >("hidden")
  const showActiveContentCaret = Boolean(
    isLast && status === "streaming" && hasContent
  )

  const didStreamInSession = Boolean(isLast && finishReason)
  const showFooterCaret = hasContent && contentCaretPhase !== "hidden"
  const showFooterActions =
    hasContent &&
    !isLastStreaming &&
    (!isLast || contentCaretPhase === "hidden")
  const showFooterSlot = showFooterCaret || showFooterActions

  if (showActiveContentCaret && contentCaretPhase !== "visible") {
    setContentCaretPhase("visible")
  } else if (
    !showActiveContentCaret &&
    status === "ready" &&
    isLast &&
    contentCaretPhase === "visible"
  ) {
    setContentCaretPhase("fading")
  } else if (
    (!isLast ||
      !hasContent ||
      (status !== "streaming" && status !== "ready")) &&
    contentCaretPhase !== "hidden"
  ) {
    setContentCaretPhase("hidden")
  }

  return (
    <Message
      className={cn("flex w-full flex-1 items-start gap-4", className)}
      data-turn="assistant"
      data-message-id={messageId}
      data-scroll-anchor={isLast ? "true" : "false"}
      tabIndex={-1}
    >
      <h6 className="sr-only">Assistant said:</h6>
      <div
        ref={messageRef}
        className={cn(
          "relative flex min-w-full flex-col gap-2",
          isLast && "pb-8"
        )}
        // Inner data-message-id for quote selection — closest() finds this before the outer article
        data-message-id={messageId}
      >
        {reasoningPhase !== "idle" && (
          <Reasoning
            isStreaming={isReasoningStreaming}
            phase={reasoningPhase}
            durationSeconds={durationSeconds}
            opaque={isOpaqueReasoning}
          >
            <ReasoningLabel />
            {!isOpaqueReasoning && (
              <ReasoningContent markdown>{reasoningText}</ReasoningContent>
            )}
          </Reasoning>
        )}

        {toolInvocationParts &&
          toolInvocationParts.length > 0 &&
          preferences.showToolInvocations && (
            <ToolInvocation
              toolInvocations={toolInvocationParts}
              metadata={metadata}
            />
          )}

        {showToolProgress && (
          <Loader
            variant="loading-dots"
            text={
              activeToolNames.length === 1
                ? formatToolProgressLabel(activeToolNames[0])
                : "Running tools"
            }
          />
        )}

        {searchImageResults.length > 0 && (
          <SearchImages results={searchImageResults} />
        )}

        {showImageGenProgress && (
          <Loader variant="loading-dots" text="Generating image" />
        )}

        {showStreamingLoader && (
          <Loader
            variant="text-shimmer"
            text="Generating"
            showCaret
            streamingIndicatorVariant={STREAMING_INDICATOR_VARIANT}
          />
        )}

        {contentNullOrEmpty ? null : (
          <MessageContent
            className={cn(
              "prose relative min-w-full bg-transparent p-0",
              "prose-h1:scroll-m-20 prose-h1:text-2xl prose-h1:font-semibold prose-h2:mt-8 prose-h2:scroll-m-20 prose-h2:text-xl prose-h2:mb-3 prose-h2:font-medium prose-h3:scroll-m-20 prose-h3:text-base prose-h3:font-medium prose-h4:scroll-m-20 prose-h5:scroll-m-20 prose-h6:scroll-m-20 prose-strong:font-medium prose-table:block prose-table:overflow-y-auto"
            )}
            markdown={true}
          >
            {children}
          </MessageContent>
        )}

        {sources && sources.length > 0 && <SourcesList sources={sources} />}

        {finishReason === "length" && status !== "streaming" && (
          <SystemMessage
            variant="warning"
            fill
            cta={
              onReload ? { label: "Regenerate", onClick: onReload } : undefined
            }
          >
            Response may be incomplete due to output length limits.
          </SystemMessage>
        )}

        {showFooterSlot && (
          <div className="relative min-h-8 pointer-coarse:min-h-10">
            {showFooterCaret && (
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center">
                <StreamingCaret
                  visible={contentCaretPhase === "visible"}
                  variant={STREAMING_INDICATOR_VARIANT}
                  className="ml-px"
                  onFadeOutComplete={() => setContentCaretPhase("hidden")}
                />
              </div>
            )}

            {showFooterActions && (
              <MessageActions
                className={cn(
                  "-ml-2 min-h-8 gap-0 pointer-coarse:min-h-10",
                  didStreamInSession
                    ? [
                        "pointer-events-auto",
                        "[mask-image:linear-gradient(to_right,black_33%,transparent_66%)]",
                        "[mask-size:300%_100%]",
                        "motion-safe:[animation:mask-reveal_1.5s_ease_forwards]",
                        "motion-reduce:[mask-image:none]",
                      ]
                    : [
                        "pointer-events-none",
                        "[mask-image:linear-gradient(to_right,black_33%,transparent_66%)]",
                        "[mask-size:300%_100%]",
                        "[mask-position:100%_0%]",
                        "motion-safe:transition-[mask-position]",
                        "duration-[1.5s]",
                        "group-hover/turn-messages:pointer-events-auto",
                        "group-hover/turn-messages:[mask-position:0_0]",
                        "group-focus-within/turn-messages:pointer-events-auto",
                        "group-focus-within/turn-messages:[mask-position:0_0]",
                        "has-[[data-state=open]]:pointer-events-auto",
                        "has-[[data-state=open]]:[mask-position:0_0]",
                        "pointer-coarse:pointer-events-auto",
                        "pointer-coarse:[mask-image:none]",
                      ]
                )}
              >
                <MessageAction
                  tooltip={copied ? "Copied!" : "Copy text"}
                  side="bottom"
                >
                  <button
                    className="hover:bg-accent/60 text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center rounded-lg bg-transparent transition pointer-coarse:h-10 pointer-coarse:w-10"
                    aria-label="Copy text"
                    onClick={copyToClipboard}
                    type="button"
                  >
                    {copied ? (
                      <Icon icon={RiCheckLine} slotSize={20} />
                    ) : (
                      <Icon icon={RiFileCopyLine} slotSize={20} />
                    )}
                  </button>
                </MessageAction>
                {isLast ? (
                  <MessageAction tooltip="Regenerate" side="bottom" delay={0}>
                    <button
                      className="hover:bg-accent/60 text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center rounded-lg bg-transparent transition pointer-coarse:h-10 pointer-coarse:w-10"
                      aria-label="Regenerate"
                      onClick={onReload}
                      type="button"
                    >
                      <Icon icon={RiRefreshLine} slotSize={20} />
                    </button>
                  </MessageAction>
                ) : null}
              </MessageActions>
            )}
          </div>
        )}

        {selectionInfo && selectionInfo.messageId && (
          <QuoteButton
            mousePosition={selectionInfo.position}
            onQuote={handleQuoteBtnClick}
            messageContainerRef={messageRef}
            onDismiss={clearSelection}
          />
        )}
      </div>
    </Message>
  )
}
