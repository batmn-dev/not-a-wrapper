"use client"

import { cn } from "@/lib/utils"
import { createContext, useContext, useMemo } from "react"
import { useStickToBottom } from "use-stick-to-bottom"
import type { StickToBottomInstance } from "use-stick-to-bottom"

type ScrollRootContextValue = Pick<
  StickToBottomInstance,
  | "scrollRef"
  | "contentRef"
  | "scrollToBottom"
  | "stopScroll"
  | "isAtBottom"
  | "isNearBottom"
  | "escapedFromLock"
>

export const ScrollRootContext = createContext<ScrollRootContextValue | null>(
  null
)

type ScrollRootProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>

function ScrollRoot({ children, className, ...props }: ScrollRootProps) {
  const {
    scrollRef,
    contentRef,
    scrollToBottom,
    stopScroll,
    isAtBottom,
    isNearBottom,
    escapedFromLock,
  } = useStickToBottom({ resize: "smooth", initial: "instant" })

  const contextValue = useMemo<ScrollRootContextValue>(
    () => ({
      scrollRef,
      contentRef,
      scrollToBottom,
      stopScroll,
      isAtBottom,
      isNearBottom,
      escapedFromLock,
    }),
    [
      scrollRef,
      contentRef,
      scrollToBottom,
      stopScroll,
      isAtBottom,
      isNearBottom,
      escapedFromLock,
    ]
  )

  return (
    <ScrollRootContext.Provider value={contextValue}>
      <div
        ref={scrollRef}
        data-scroll-root=""
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-x-clip overflow-y-auto",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </ScrollRootContext.Provider>
  )
}

function useScrollRoot() {
  const context = useContext(ScrollRootContext)
  if (!context) {
    throw new Error("useScrollRoot must be used within a <ScrollRoot> provider")
  }
  return context
}

type ScrollRootContentProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>

function ScrollRootContent({
  children,
  className,
  ...props
}: ScrollRootContentProps) {
  const { contentRef } = useScrollRoot()
  return (
    <div ref={contentRef} className={className} {...props}>
      {children}
    </div>
  )
}

export { ScrollRoot, useScrollRoot, ScrollRootContent }
