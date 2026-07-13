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

/**
 * Marker/body variants are intentional scaffolding for the planned multi-step
 * timeline; production currently renders only the completed description form.
 */
const stepVariants = cva("min-w-0 pb-5 group-data-[last=true]:pb-0", {
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

/** Marker glyph in a fixed-width rail. */
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
  /** Injected by `ActivityTimeline`; hides the trailing rail on the last step. */
  isLast?: boolean
  /** Injected by `ActivityTimeline`; ascending z-index so rails overlap. */
  index?: number
} & VariantProps<typeof stepVariants>

/** A non-collapsible timeline step whose rail reaches the next marker center. */
export const ActivityStep = ({
  children,
  className,
  isLast = false,
  index = 0,
  leading = "bullet",
  body = "description",
}: ActivityStepProps) => (
  <div
    className="group relative grid animate-[show_150ms_ease-in] grid-cols-[min-content_minmax(0,1fr)] gap-x-2 motion-reduce:animate-none"
    data-activity-step
    data-last={isLast}
    style={{ zIndex: index + 1 }}
  >
    <div className="relative flex flex-col items-center">
      <StepLeadingIndicator leading={leading ?? "bullet"} />
      <div className="bg-border absolute top-2.5 bottom-[-10px] left-1/2 w-px -translate-x-1/2 group-data-[last=true]:hidden" />
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

/** Inject connector termination and stacking order into each timeline step. */
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
