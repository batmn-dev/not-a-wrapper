"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipMultiline,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  deriveGenerationStatsView,
  formatMsAsSeconds,
  formatTokenCount,
  formatTokensPerSecond,
  type GenerationStats,
} from "@/lib/chat-messages/generation-stats"

/**
 * The Generation stats line (ADR-0030): plain text in the response actions
 * row, settled turns only, behind the `showGenerationStats` preference. The
 * view is a closed union, so a rate can only render from a valid window and
 * absent provider usage leaves time to first output standing alone. Hover or
 * keyboard focus reveals exact milliseconds and the token breakdown: the
 * trigger is a real button so Tab reaches it, styled as plain text with the
 * Button keyboard outline.
 */
export function GenerationStatsLine({
  stats,
}: {
  stats: GenerationStats | undefined
}) {
  const view = deriveGenerationStatsView(stats)
  if (view.kind === "none") return null

  const segments: string[] = []
  const detail: string[] = []

  if (view.kind === "complete") {
    if (view.tokensPerSecond !== undefined) {
      segments.push(`${formatTokensPerSecond(view.tokensPerSecond)} tok/s`)
    }
    segments.push(`${formatTokenCount(view.outputTokens)} tokens`)
    if (view.timeToFirstTokenMs !== undefined) {
      segments.push(
        `${formatMsAsSeconds(view.timeToFirstTokenMs)} s to first output`
      )
      detail.push(
        `Time to first output: ${Math.round(view.timeToFirstTokenMs)} ms`
      )
    }
    if (view.outputStreamMs !== undefined) {
      detail.push(`Output window: ${Math.round(view.outputStreamMs)} ms`)
    }
    detail.push(
      `Output tokens: ${formatTokenCount(view.outputTokens)}` +
        (view.reasoningTokens !== undefined
          ? ` (${formatTokenCount(view.reasoningTokens)} reasoning)`
          : "")
    )
    if (view.tokensPerSecond !== undefined && view.reasoningTokens) {
      detail.push(
        `Rate counts the ${formatTokenCount(view.visibleOutputTokens)} visible tokens; reasoning excluded`
      )
    }
    if (view.inputTokens !== undefined) {
      detail.push(
        `Input tokens: ${formatTokenCount(view.inputTokens)}` +
          (view.cachedInputTokens !== undefined
            ? ` (${formatTokenCount(view.cachedInputTokens)} cached)`
            : "")
      )
    }
    if (view.stepCount !== undefined && view.stepCount > 1) {
      detail.push(
        `${view.stepCount} steps; client tool execution excluded from the window`
      )
    }
    if (view.providerToolCalls !== undefined && view.providerToolCalls > 0) {
      detail.push(
        `${view.providerToolCalls} provider-run tool ${
          view.providerToolCalls === 1 ? "call" : "calls"
        } inside the output window`
      )
    }
  } else {
    segments.push(
      `${formatMsAsSeconds(view.timeToFirstTokenMs)} s to first output`
    )
    detail.push(
      `Time to first output: ${Math.round(view.timeToFirstTokenMs)} ms`
    )
    detail.push("Token counts unavailable: the provider did not report usage")
  }
  detail.push("Measured from the provider request on the server")

  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={<button type="button" />}
        className="keyboard-focused:[outline-color:var(--interactive-outline-color,var(--text-primary))] keyboard-focused:outline-[1.5px] keyboard-focused:outline-offset-[2.5px] keyboard-focused:[outline-style:solid] ms-1 cursor-default self-center rounded-[8px] px-2 text-xs text-[var(--text-tertiary)] tabular-nums outline-hidden select-none"
        data-testid="generation-stats"
      >
        {segments.join(" · ")}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <TooltipMultiline className="items-start text-start">
          {detail.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </TooltipMultiline>
      </TooltipContent>
    </Tooltip>
  )
}
