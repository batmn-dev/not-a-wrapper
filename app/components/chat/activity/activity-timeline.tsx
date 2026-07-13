"use client"

import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import {
  RiBrain2Line,
  RiCheckboxBlankCircleFill,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiCodeLine,
  RiGlobalLine,
  RiImageLine,
  RiQuestionLine,
  RiStopCircleLine,
} from "@remixicon/react"
import { cva, type VariantProps } from "class-variance-authority"
import React from "react"

/** Activity markers use semantic colors and preserve the reference dimensions. */
const STEP_MARKERS = {
  bullet: {
    icon: RiCheckboxBlankCircleFill,
    slotSize: 6,
    glyphSize: 6,
    className: "text-muted-foreground fill-current",
  },
  search: {
    icon: RiGlobalLine,
    slotSize: 15,
    glyphSize: 15,
    className: "text-muted-foreground",
  },
  code: {
    icon: RiCodeLine,
    slotSize: 15,
    glyphSize: 15,
    className: "text-muted-foreground",
  },
  reasoning: {
    icon: RiBrain2Line,
    slotSize: 15,
    glyphSize: 15,
    className: "text-muted-foreground",
  },
  image: {
    icon: RiImageLine,
    slotSize: 15,
    glyphSize: 15,
    className: "text-muted-foreground",
  },
  approval: {
    icon: RiQuestionLine,
    slotSize: 15,
    glyphSize: 15,
    className: "text-amber-600 dark:text-amber-400",
  },
  error: {
    icon: RiCloseCircleLine,
    slotSize: 15,
    glyphSize: 15,
    className: "text-destructive",
  },
  stopped: {
    icon: RiStopCircleLine,
    slotSize: 15,
    glyphSize: 15,
    className: "text-muted-foreground",
  },
  completedRun: {
    icon: RiCheckboxCircleLine,
    slotSize: 15,
    glyphSize: 15,
    className: "text-muted-foreground",
  },
} as const

export type ActivityStepLeading = keyof typeof STEP_MARKERS

const stepVariants = cva("w-full min-w-0 mb-3 group-data-[last=true]:mb-0", {
  variants: {
    leading: {
      search: "",
      code: "",
      reasoning: "",
      image: "",
      approval: "",
      error: "",
      stopped: "",
      bullet: "",
      completedRun: "",
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

/** Marker glyph in a fixed-width icon slot. */
export function StepLeadingIndicator({
  leading = "bullet",
  className,
}: StepLeadingIndicatorProps) {
  const marker = STEP_MARKERS[leading]
  return (
    <span
      className={cn(
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

export function StepTitle({ children, className }: StepTitleProps) {
  return (
    <div className={cn("text-foreground text-sm leading-[21px]", className)}>
      {children}
    </div>
  )
}

export type ActivityStepProps = {
  children: React.ReactNode
  className?: string
  /** Injected by `ActivityTimeline`; the final row has no trailing connector. */
  isLast?: boolean
  /** Injected by `ActivityTimeline`; matches the reference row stacking order. */
  index?: number
} & VariantProps<typeof stepVariants>

/** A timeline row whose connector begins below its fixed-height icon slot. */
export const ActivityStep = ({
  children,
  className,
  isLast = false,
  index = 0,
  leading = "bullet",
  body = "description",
}: ActivityStepProps) => (
  <div
    className="group mb-2 flex animate-[show_150ms_ease-in] motion-reduce:animate-none"
    data-activity-step
    data-last={isLast}
    style={{ zIndex: index }}
  >
    <div className="relative flex w-full items-start gap-2 overflow-clip">
      <div className="flex h-full w-4 shrink-0 flex-col items-center">
        <StepLeadingIndicator leading={leading ?? "bullet"} />
        {!isLast ? (
          <div
            data-activity-connector
            className="h-full w-px rounded-full bg-[var(--border-heavy)]"
          />
        ) : null}
      </div>
      <div className={cn(stepVariants({ leading, body }), className)}>
        {children}
      </div>
    </div>
  </div>
)

export type ActivityTimelineProps = {
  children: React.ReactNode
  className?: string
}

export function ActivityTimeline({
  children,
  className,
}: ActivityTimelineProps) {
  const childrenArray = React.Children.toArray(children)

  return (
    <div className={cn("relative isolate flex flex-col", className)}>
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
