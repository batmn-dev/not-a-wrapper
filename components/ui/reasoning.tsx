/**
 * Based on prompt-kit: https://prompt-kit.com/docs/reasoning
 * Local contracts: phase-aware presentation, render-synced streaming state,
 * and CSS-grid disclosure without effect or scroll-height measurement.
 */
"use client"

import { Icon } from "@/components/ui/icon"
import { TextShimmer } from "@/components/ui/text-shimmer"
import { formatDuration } from "@/lib/format-duration"
import { cn } from "@/lib/utils"
import { RiArrowDownSLine } from "@remixicon/react"
import React, { createContext, useContext, useState } from "react"
import { LazyMarkdown as Markdown } from "./lazy-markdown"

type ReasoningContextType = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  phase: "idle" | "thinking" | "complete"
  durationSeconds: number | undefined
  opaque: boolean
}

const ReasoningContext = createContext<ReasoningContextType | undefined>(
  undefined
)

function useReasoningContext() {
  const context = useContext(ReasoningContext)
  if (!context) {
    throw new Error(
      "useReasoningContext must be used within a Reasoning provider"
    )
  }
  return context
}

export type ReasoningProps = {
  children: React.ReactNode
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  isStreaming?: boolean
  phase?: "idle" | "thinking" | "complete"
  durationSeconds?: number
  opaque?: boolean
}
function Reasoning({
  children,
  className,
  open,
  onOpenChange,
  isStreaming,
  phase: phaseProp,
  durationSeconds,
  opaque = false,
}: ReasoningProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [wasAutoOpened, setWasAutoOpened] = useState(false)
  const [prevIsStreaming, setPrevIsStreaming] = useState(isStreaming)

  // Derive phase from prop, falling back to isStreaming for backward compat
  const phase = phaseProp ?? (isStreaming ? "thinking" : "complete")

  const isControlled = open !== undefined
  const isOpen = opaque ? false : isControlled ? open : internalOpen

  // React 19 pattern: sync during render instead of useEffect
  if (isStreaming !== prevIsStreaming) {
    setPrevIsStreaming(isStreaming)
    if (!opaque) {
      if (isStreaming && !wasAutoOpened) {
        if (!isControlled) setInternalOpen(true)
        setWasAutoOpened(true)
      }
      if (!isStreaming && wasAutoOpened) {
        if (!isControlled) setInternalOpen(false)
        setWasAutoOpened(false)
      }
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (opaque) return
    if (!isControlled) {
      setInternalOpen(newOpen)
    }
    onOpenChange?.(newOpen)
  }

  return (
    <ReasoningContext.Provider
      value={{
        isOpen,
        onOpenChange: handleOpenChange,
        phase,
        durationSeconds,
        opaque,
      }}
    >
      <div className={className}>{children}</div>
    </ReasoningContext.Provider>
  )
}

export type ReasoningTriggerProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLAttributes<HTMLButtonElement>

function ReasoningTrigger({
  children,
  className,
  ...props
}: ReasoningTriggerProps) {
  const { isOpen, onOpenChange } = useReasoningContext()

  return (
    <button
      className={cn("flex cursor-pointer items-center gap-2", className)}
      onClick={() => onOpenChange(!isOpen)}
      {...props}
    >
      <span className="text-primary">{children}</span>
      <div
        className={cn(
          "transform transition-transform",
          isOpen ? "rotate-180" : ""
        )}
      >
        <Icon icon={RiArrowDownSLine} slotSize={16} />
      </div>
    </button>
  )
}

export type ReasoningLabelProps = {
  className?: string
  /**
   * Optional leading title rendered as a `title · duration` cluster (the
   * reference "Activity · 5m 42s" panel header). Omitted at the inline call
   * site, so existing output is unchanged. Dormant until the Activity panel.
   */
  title?: string
}

function ReasoningLabel({ className, title }: ReasoningLabelProps) {
  const { isOpen, onOpenChange, phase, durationSeconds, opaque } =
    useReasoningContext()

  if (phase === "idle") return null

  const durationText =
    durationSeconds !== undefined && durationSeconds > 0
      ? formatDuration(durationSeconds)
      : undefined

  if (opaque && phase === "complete" && durationText === undefined) return null

  const labelText =
    title !== undefined ? (
      <>
        <span className="text-muted-foreground font-normal">{title}</span>
        {durationText && (
          <>
            <span
              aria-hidden
              className="font-normal text-[var(--text-tertiary)]"
            >
              ·
            </span>
            {phase === "thinking" ? (
              <TextShimmer
                duration={2}
                spread={15}
                className="text-base font-normal whitespace-nowrap"
              >
                {durationText}
              </TextShimmer>
            ) : (
              <span className="font-normal whitespace-nowrap text-[var(--text-tertiary)]">
                {durationText}
              </span>
            )}
          </>
        )}
      </>
    ) : phase === "thinking" ? (
      <>
        <TextShimmer duration={2} spread={15} className="text-base font-normal">
          Thinking
        </TextShimmer>
        {durationSeconds !== undefined && durationSeconds > 0 && (
          <span className="text-muted-foreground ml-1 text-base font-normal">
            {formatDuration(durationSeconds)}
          </span>
        )}
      </>
    ) : (
      <span className="text-muted-foreground font-normal">
        {durationSeconds !== undefined
          ? `Thought for ${formatDuration(durationSeconds)}`
          : "Thought"}
      </span>
    )

  if (opaque) {
    return (
      <span className={cn("flex items-center gap-1.5 text-base", className)}>
        {labelText}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={cn(
        "flex cursor-pointer items-center gap-1.5 text-base",
        className
      )}
      onClick={() => onOpenChange(!isOpen)}
    >
      {labelText}
      <div
        className={cn(
          "text-muted-foreground transform transition-transform",
          isOpen ? "rotate-180" : ""
        )}
      >
        <Icon icon={RiArrowDownSLine} slotSize={14} />
      </div>
    </button>
  )
}

export type ReasoningContentProps = {
  children: React.ReactNode
  className?: string
  markdown?: boolean
  contentClassName?: string
} & React.HTMLAttributes<HTMLDivElement>

function ReasoningContent({
  children,
  className,
  contentClassName,
  markdown = false,
  ...props
}: ReasoningContentProps) {
  const { isOpen } = useReasoningContext()

  const content = markdown ? (
    <Markdown>{children as string}</Markdown>
  ) : (
    children
  )

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-150 ease-out",
        isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "text-muted-foreground prose overflow-hidden",
          contentClassName
        )}
      >
        {content}
      </div>
    </div>
  )
}

export {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningLabel,
  // Re-exported for back-compat; the canonical home is `@/lib/format-duration`.
  // The Activity panel header/trigger reuse ONLY this formatter, not the
  // Reasoning/ReasoningLabel shell (those own disclosure + auto-open state).
  formatDuration,
}
