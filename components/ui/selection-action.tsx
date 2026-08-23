"use client"

import { cn } from "@/lib/utils"
import { useCallback } from "react"

type SelectionActionProps = Omit<React.ComponentProps<"div">, "children"> & {
  children: React.ReactNode
  container: HTMLElement
  range: Range
}

type SelectionAnchorGeometry = {
  blockSize: number
  blockStart: number
  inlineSize: number
  inlineStart: number
}

export function getSelectionAnchorGeometry(
  selectionRect: Pick<
    DOMRect,
    "bottom" | "height" | "left" | "right" | "top" | "width"
  >,
  containerRect: Pick<DOMRect, "left" | "right" | "top">,
  direction: "ltr" | "rtl"
): SelectionAnchorGeometry {
  return {
    blockSize: selectionRect.height,
    blockStart: selectionRect.top - containerRect.top,
    inlineSize: selectionRect.width,
    inlineStart:
      direction === "rtl"
        ? containerRect.right - selectionRect.right
        : selectionRect.left - containerRect.left,
  }
}

function writeSelectionAnchorGeometry(
  layer: HTMLDivElement,
  container: HTMLElement,
  range: Range
) {
  const geometry = getSelectionAnchorGeometry(
    range.getBoundingClientRect(),
    container.getBoundingClientRect(),
    getComputedStyle(container).direction === "rtl" ? "rtl" : "ltr"
  )
  const { style } = layer

  style.setProperty(
    "--targeted-action-anchor-block-size",
    `${geometry.blockSize}px`
  )
  style.setProperty(
    "--targeted-action-anchor-block-start",
    `${geometry.blockStart}px`
  )
  style.setProperty(
    "--targeted-action-anchor-inline-size",
    `${geometry.inlineSize}px`
  )
  style.setProperty(
    "--targeted-action-anchor-inline-start",
    `${geometry.inlineStart}px`
  )
}

/**
 * Positions an action from the selected DOM Range rather than a pointer or a
 * hard-coded action size. The callback ref writes before paint and keeps the
 * synthetic CSS anchor current when the selected message reflows.
 */
export function SelectionAction({
  children,
  className,
  container,
  range,
  ...props
}: SelectionActionProps) {
  const layerRef = useCallback(
    (layer: HTMLDivElement | null) => {
      if (!layer) return

      const update = () => writeSelectionAnchorGeometry(layer, container, range)
      update()

      if (typeof ResizeObserver === "undefined") return

      const observer = new ResizeObserver(update)
      observer.observe(container)
      return () => observer.disconnect()
    },
    [container, range]
  )

  return (
    <div
      ref={layerRef}
      data-slot="selection-action"
      className="contents"
      {...props}
    >
      <span
        aria-hidden="true"
        data-slot="selection-action-anchor"
        className="selection-action-anchor"
      />
      <div
        data-slot="selection-action-positioner"
        className={cn("selection-action-positioner z-50", className)}
      >
        {children}
      </div>
    </div>
  )
}
