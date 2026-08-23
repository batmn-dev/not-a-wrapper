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
}: ScrollShadowWrapperProps) {
  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 h-4",
          "from-sidebar bg-gradient-to-b to-transparent",
          "scroll-state-opacity-top duration-150 motion-safe:transition-opacity"
        )}
        aria-hidden="true"
      />

      {children}

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 h-4",
          "from-sidebar bg-gradient-to-t to-transparent",
          "scroll-state-opacity-bottom duration-150 motion-safe:transition-opacity"
        )}
        aria-hidden="true"
      />
    </div>
  )
}
