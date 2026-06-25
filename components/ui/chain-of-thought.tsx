"use client"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import {
  RiArrowDownSLine,
  RiCheckboxBlankCircleFill,
  RiCheckLine,
  RiGlobeLine,
} from "@remixicon/react"
import React from "react"

const LEADING_MARKERS = {
  bullet: {
    icon: RiCheckboxBlankCircleFill,
    slotSize: 8,
    className: "fill-current",
  },
  globe: {
    icon: RiGlobeLine,
    slotSize: 16,
    className: "text-muted-foreground",
  },
  done: { icon: RiCheckLine, slotSize: 16, className: "text-foreground" },
} as const

export type ChainOfThoughtLeading = keyof typeof LEADING_MARKERS

export type ChainOfThoughtItemProps = React.ComponentProps<"div">

export const ChainOfThoughtItem = ({
  children,
  className,
  ...props
}: ChainOfThoughtItemProps) => (
  <div
    className={cn("text-muted-foreground text-sm font-normal", className)}
    {...props}
  >
    {children}
  </div>
)

export type ChainOfThoughtTriggerProps = React.ComponentProps<
  typeof CollapsibleTrigger
> & {
  leftIcon?: React.ReactNode
  swapIconOnHover?: boolean
  /**
   * Leading marker shown when no `leftIcon` is provided. `bullet` (default)
   * preserves the original dot exactly; `globe`/`done` add the reference
   * timeline variants. Additive — existing call sites render the same dot.
   */
  leading?: ChainOfThoughtLeading
}

export const ChainOfThoughtTrigger = ({
  children,
  className,
  leftIcon,
  swapIconOnHover = true,
  leading = "bullet",
  ...props
}: ChainOfThoughtTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      "group text-muted-foreground hover:text-foreground flex cursor-pointer items-center justify-start gap-1 text-left text-sm font-normal",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-2">
      {leftIcon ? (
        <span className="relative inline-flex size-4 items-center justify-center">
          <span
            className={cn(
              "transition-opacity",
              swapIconOnHover && "group-hover:opacity-0"
            )}
          >
            {leftIcon}
          </span>
          {swapIconOnHover && (
            <Icon
              icon={RiArrowDownSLine}
              slotSize={16}
              className="absolute opacity-0 transition-opacity group-hover:opacity-100 group-data-[open]:rotate-180"
            />
          )}
        </span>
      ) : (
        <span className="relative inline-flex size-4 items-center justify-center">
          <Icon
            icon={LEADING_MARKERS[leading].icon}
            slotSize={LEADING_MARKERS[leading].slotSize}
            className={LEADING_MARKERS[leading].className}
          />
        </span>
      )}
      <span>{children}</span>
    </div>
    {!leftIcon && (
      <Icon
        icon={RiArrowDownSLine}
        slotSize={16}
        className="transition-transform group-data-[open]:rotate-180"
      />
    )}
  </CollapsibleTrigger>
)

export type ChainOfThoughtContentProps = React.ComponentProps<
  typeof CollapsibleContent
>

export const ChainOfThoughtContent = ({
  children,
  className,
  ...props
}: ChainOfThoughtContentProps) => {
  return (
    <CollapsibleContent
      className={cn(
        "text-popover-foreground data-[closed]:animate-collapsible-up data-[open]:animate-collapsible-down overflow-hidden",
        className
      )}
      {...props}
    >
      <div className="grid grid-cols-[min-content_minmax(0,1fr)] gap-x-4">
        <div className="bg-primary/20 ml-1.75 h-full w-px group-data-[last=true]:hidden" />
        <div className="ml-1.75 h-full w-px bg-transparent group-data-[last=false]:hidden" />
        <div className="mt-2 space-y-2">{children}</div>
      </div>
    </CollapsibleContent>
  )
}

export type ChainOfThoughtProps = {
  children: React.ReactNode
  className?: string
}

export function ChainOfThought({ children, className }: ChainOfThoughtProps) {
  const childrenArray = React.Children.toArray(children)

  return (
    <div className={cn("space-y-0", className)}>
      {childrenArray.map((child, index) => (
        <React.Fragment key={index}>
          {React.isValidElement(child) &&
            React.cloneElement(
              child as React.ReactElement<ChainOfThoughtStepProps>,
              {
                isLast: index === childrenArray.length - 1,
              }
            )}
        </React.Fragment>
      ))}
    </div>
  )
}

export type ChainOfThoughtStepProps = {
  children: React.ReactNode
  className?: string
  isLast?: boolean
}

export const ChainOfThoughtStep = ({
  children,
  className,
  isLast = false,
  ...props
}: ChainOfThoughtStepProps & React.ComponentProps<typeof Collapsible>) => {
  return (
    <Collapsible
      className={cn("group", className)}
      data-last={isLast}
      {...props}
    >
      {children}
      <div className="flex justify-start group-data-[last=true]:hidden">
        <div className="bg-primary/20 ml-1.75 h-4 w-px" />
      </div>
    </Collapsible>
  )
}
