"use client"

import { cn } from "@/lib/utils"
import * as React from "react"

type ScrollShadowWrapperProps = {
  children: React.ReactNode
  className?: string
  /** Ref to the scrollable viewport element (from ScrollArea) */
  viewportRef?: React.RefObject<HTMLDivElement | null>
}

export function ScrollShadowWrapper({
  children,
  className,
  viewportRef,
}: ScrollShadowWrapperProps) {
  const [scrollState, setScrollState] = React.useState({
    top: false,
    bottom: false,
  })

  React.useEffect(() => {
    const viewport = viewportRef?.current
    if (!viewport) return

    const updateScrollState = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport
      setScrollState({
        top: scrollTop > 10,
        bottom: scrollTop + clientHeight < scrollHeight - 10,
      })
    }

    updateScrollState()
    viewport.addEventListener("scroll", updateScrollState, { passive: true })

    // ResizeObserver for dynamic content
    const resizeObserver = new ResizeObserver(updateScrollState)
    resizeObserver.observe(viewport)

    return () => {
      viewport.removeEventListener("scroll", updateScrollState)
      resizeObserver.disconnect()
    }
  }, [viewportRef])

  return (
    <div className={cn("relative", className)}>
      {/* Top shadow */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 h-4",
          "from-sidebar bg-gradient-to-b to-transparent",
          "duration-150 motion-safe:transition-opacity",
          scrollState.top ? "opacity-100" : "opacity-0"
        )}
        aria-hidden="true"
      />

      {children}

      {/* Bottom shadow */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 h-4",
          "from-sidebar bg-gradient-to-t to-transparent",
          "duration-150 motion-safe:transition-opacity",
          scrollState.bottom ? "opacity-100" : "opacity-0"
        )}
        aria-hidden="true"
      />
    </div>
  )
}
