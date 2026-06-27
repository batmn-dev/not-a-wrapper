"use client"

import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import {
  RiCheckboxBlankCircleFill,
  RiCheckLine,
  RiGlobeLine,
} from "@remixicon/react"
import { cva, type VariantProps } from "class-variance-authority"
import React from "react"

/**
 * Leading markers for an Activity step. Mirrors `LEADING_MARKERS` in
 * `components/ui/chain-of-thought.tsx:18-30` (scoped down to the reference's
 * bullet dot 6px and globe/done glyphs 15px)
 * WITHOUT editing that shared primitive (plan §5 commit 1, GA §D4). Glyphs
 * render through `Icon` (`currentColor`), tinted by semantic text tokens — the
 * sprite-id hashes from the reference are intentionally ignored (GA §4 rows
 * 20-22).
 */
const STEP_MARKERS = {
  bullet: {
    icon: RiCheckboxBlankCircleFill,
    slotSize: 6,
    glyphSize: 6,
    className: "fill-current",
  },
  globe: {
    icon: RiGlobeLine,
    slotSize: 15,
    glyphSize: 15,
    className: "text-muted-foreground",
  },
  done: {
    icon: RiCheckLine,
    slotSize: 15,
    glyphSize: 15,
    className: "text-foreground",
  },
} as const

export type ActivityStepLeading = keyof typeof STEP_MARKERS

/**
 * `stepVariants` — the documented cva axes for a step (GA §D4): `leading`
 * selects the marker glyph, `body` selects how the content column is laid out
 * (chips vs. prose description). Mirrors the `button.tsx` cva idiom; the
 * `leading` axis is style-neutral here because the marker glyph is resolved via
 * `STEP_MARKERS`, but the axis is preserved for the documented API + the
 * reference variant matrix (globe⇒chips, bullet/done⇒description).
 */
const stepVariants = cva("min-w-0 pb-5 group-data-[last=true]:pb-0", {
  variants: {
    leading: {
      globe: "",
      bullet: "",
      done: "",
    },
    body: {
      chips: "space-y-1.5",
      description: "space-y-1",
    },
  },
  defaultVariants: {
    leading: "bullet",
    body: "description",
  },
})

export type StepLeadingIndicatorProps = {
  leading?: ActivityStepLeading
  className?: string
}

/**
 * StepLeadingIndicator — the marker glyph in a fixed 16px box, reusing the
 * exact `Icon` call shape from `chain-of-thought.tsx:98-102`.
 */
export function StepLeadingIndicator({
  leading = "bullet",
  className,
}: StepLeadingIndicatorProps) {
  const marker = STEP_MARKERS[leading]
  return (
    <span
      className={cn(
        // 20px-tall × 16px-wide marker slot (reference: h-5 box in a w-4 rail),
        // so the glyph centers against the step title's first line.
        "relative inline-flex h-5 w-4 shrink-0 items-center justify-center",
        className
      )}
    >
      <Icon
        icon={marker.icon}
        slotSize={marker.slotSize}
        glyphSize={marker.glyphSize}
        className={marker.className}
      />
    </span>
  )
}

export type StepTitleProps = {
  children: React.ReactNode
  className?: string
}

/**
 * StepTitle — the always-visible step title (`text-foreground`, 14px). Always
 * rendered (non-collapsible timeline), unlike the inline ChainOfThought trigger.
 */
export function StepTitle({ children, className }: StepTitleProps) {
  return (
    <div className={cn("text-foreground text-sm", className)}>{children}</div>
  )
}

export type ActivityStepProps = {
  children: React.ReactNode
  className?: string
  /** Injected by `ActivityTimeline`; hides the trailing rail on the last step. */
  isLast?: boolean
  /** Injected by `ActivityTimeline`; ascending z-index so rails overlap. */
  index?: number
} & VariantProps<typeof stepVariants>

/**
 * ActivityStep — a single non-collapsible timeline step: a marker + a
 * continuous rail in the leading column, and the title/body content in the
 * trailing column. Mirrors `ChainOfThoughtStep` (`chain-of-thought.tsx:174-192`)
 * — `group` wrapper, `data-last`, `bg-border w-px` rail hidden via
 * `group-data-[last=true]:hidden` — but uses a full-height rail (no fixed `h-4`)
 * because the body is always visible and multi-line. The rail keeps the page
 * hairline token strategy; no stronger border tier exists for the panel.
 */
export const ActivityStep = ({
  children,
  className,
  isLast = false,
  index = 0,
  leading = "bullet",
  body = "description",
}: ActivityStepProps) => (
  <div
    className="group relative grid grid-cols-[min-content_minmax(0,1fr)] gap-x-2"
    data-last={isLast}
    style={{ zIndex: index + 1 }}
  >
    <div className="relative flex flex-col items-center">
      <StepLeadingIndicator leading={leading ?? "bullet"} />
      <div className="bg-border mt-1 w-px flex-1 group-data-[last=true]:hidden" />
    </div>
    <div className={cn(stepVariants({ leading, body }), className)}>
      {children}
    </div>
  </div>
)

export type ActivityTimelineProps = {
  children: React.ReactNode
  className?: string
}

/**
 * ActivityTimeline — maps `ActivityStep` children, injecting `isLast` (last
 * step omits its connector) and an ascending `index` so each step's rail
 * stacks above the previous inside a `relative isolate` context (GA §5 Step B
 * "Animations"). Mirrors the `cloneElement` mapper at
 * `chain-of-thought.tsx:148-166`.
 */
export function ActivityTimeline({
  children,
  className,
}: ActivityTimelineProps) {
  const childrenArray = React.Children.toArray(children)

  return (
    <div className={cn("relative isolate", className)}>
      {childrenArray.map((child, index) => (
        <React.Fragment key={index}>
          {React.isValidElement(child) &&
            React.cloneElement(child as React.ReactElement<ActivityStepProps>, {
              isLast: index === childrenArray.length - 1,
              index,
            })}
        </React.Fragment>
      ))}
    </div>
  )
}
