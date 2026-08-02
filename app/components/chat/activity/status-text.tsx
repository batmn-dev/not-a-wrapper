"use client"

import { TextShimmer } from "@/components/ui/text-shimmer"
import { cn } from "@/lib/utils"
import type { ComponentPropsWithoutRef, ReactNode } from "react"

const STATUS_TEXT_CLASS = "text-base leading-6 font-normal"
const ACTIVITY_STATUS_ROW_CLASS = "inline-flex h-6 items-center gap-0.5"

/**
 * StatusText — the one shimmer-or-plain status label shared by the assistant
 * activity indicator and the panel trigger, so the shimmer parameters,
 * typography, and motion-reduce policy cannot drift between the two. Color is
 * left to the caller: the indicator pins `text-muted-foreground`, the trigger
 * inherits from its button so hover can tint it.
 */
export function StatusText({
  label,
  shimmer,
  className,
}: {
  label: string
  shimmer: boolean
  className?: string
}) {
  return shimmer ? (
    <TextShimmer
      duration={2}
      spread={15}
      className={cn(STATUS_TEXT_CLASS, "motion-reduce:animate-none", className)}
    >
      {label}
    </TextShimmer>
  ) : (
    <span className={cn(STATUS_TEXT_CLASS, className)}>{label}</span>
  )
}

/**
 * The shared inline geometry for every assistant activity state. Keeping the
 * 24px row, label typography, and trailing-control gap together prevents the
 * passive, live, and disclosure presentations from drifting independently.
 */
type ActivityStatusRowProps = {
  label: string
  shimmer: boolean
  trailing?: ReactNode
} & Omit<ComponentPropsWithoutRef<"span">, "children">

export function ActivityStatusRow({
  label,
  shimmer,
  trailing,
  className,
  ...props
}: ActivityStatusRowProps) {
  return (
    <span
      {...props}
      data-slot="activity-status-row"
      className={cn(ACTIVITY_STATUS_ROW_CLASS, className)}
    >
      <StatusText label={label} shimmer={shimmer} className="truncate" />
      {trailing}
    </span>
  )
}
