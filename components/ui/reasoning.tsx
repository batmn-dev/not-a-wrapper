/**
 * @component Reasoning
 * @source prompt-kit
 * @upstream https://prompt-kit.com/docs/reasoning
 * @customized true
 * @customizations
 *   - Uses React 19 render-sync pattern instead of useEffect for streaming state
 *   - Upstream: `useEffect(() => { if (isStreaming...) }, [isStreaming])`
 *   - This project: Syncs state during render to avoid extra render cycle
 *   - This follows React 19 best practices for derived state patterns
 *   - Added phase-aware ReasoningLabel with shimmer, duration, and chevron
 *   - Extended context with phase and durationSeconds for unified thinking UX
 *   - The simpler version at `app/components/chat/reasoning.tsx` has been removed;
 *     this is now the single reasoning component used throughout the app
 *   - ReasoningContent uses CSS grid 0fr/1fr animation instead of JS scrollHeight measurement
 *     (fixes content cutoff bug caused by stale max-height values during streaming)
 * @upgradeNotes
 *   - Do NOT revert to useEffect pattern for isStreaming state sync
 *   - Preserve the `if (isStreaming !== prevIsStreaming)` render-sync block
 *   - This pattern reduces render cycles and effect cleanup overhead
 *   - Do NOT revert ReasoningContent to scrollHeight/max-height pattern — the CSS grid
 *     approach is inherently correct and avoids measurement race conditions
 */
"use client"

import { Icon } from "@/components/ui/icon"
import { TextShimmer } from "@/components/ui/text-shimmer"
import { cn } from "@/lib/utils"
import { RiArrowDownSLine } from "@remixicon/react"
import React, { createContext, useContext, useState } from "react"
import { Markdown } from "./markdown"

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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
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
}

function ReasoningLabel({ className }: ReasoningLabelProps) {
  const { isOpen, onOpenChange, phase, durationSeconds, opaque } =
    useReasoningContext()

  if (phase === "idle") return null

  const labelText =
    phase === "thinking" ? (
      <>
        <TextShimmer duration={2} spread={15} className="text-base font-medium">
          Thinking
        </TextShimmer>
        {durationSeconds !== undefined && durationSeconds > 0 && (
          <span className="text-muted-foreground ml-1 text-base font-normal">
            {formatDuration(durationSeconds)}
          </span>
        )}
      </>
    ) : (
      <span className="text-muted-foreground font-medium">
        {durationSeconds !== undefined
          ? `Thought for ${formatDuration(durationSeconds)}`
          : "Thoughts"}
      </span>
    )

  if (opaque) {
    return (
      <div className={cn("flex items-center gap-1.5 text-base", className)}>
        {labelText}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={cn(
        "flex cursor-pointer items-center gap-1.5 text-base transition-colors",
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

export { Reasoning, ReasoningTrigger, ReasoningContent, ReasoningLabel }
