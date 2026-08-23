/**
 * @component TextShimmer
 * @source prompt-kit
 * @upstream https://prompt-kit.com/docs/text-shimmer
 * @customized true
 * @customizations
 *   - Adds configurable `duration` prop (default: 4 seconds)
 *   - Adds configurable `spread` prop (default: 20, range: 5-45)
 *   - Adds the captured tertiary status variant used by bare assistant work
 *   - Upstream has fixed animation timing; this project allows customization
 *   - Enables fine-tuning of shimmer effect speed and gradient width
 * @upgradeNotes
 *   - Preserve duration and spread props with their default values
 *   - Maintain dynamicSpread clamping logic (min: 5, max: 45)
 *   - Verify animationDuration inline style is preserved
 */
"use client"

import { cn } from "@/lib/utils"

export type TextShimmerProps = {
  as?: string
  duration?: number
  spread?: number
  variant?: "default" | "tertiary"
  children: React.ReactNode
} & React.HTMLAttributes<HTMLElement>

export function TextShimmer({
  as = "span",
  className,
  duration = 4,
  spread = 20,
  variant = "default",
  children,
  ...props
}: TextShimmerProps) {
  const Component = as as React.ElementType

  if (variant === "tertiary") {
    return (
      <Component
        className={cn("loading-shimmer-tertiary", className)}
        {...props}
      >
        {children}
      </Component>
    )
  }

  const dynamicSpread = Math.min(Math.max(spread, 5), 45)

  return (
    <Component
      className={cn(
        "bg-size-[200%_auto] bg-clip-text font-normal text-transparent",
        "animate-[shimmer_4s_infinite_linear]",
        className
      )}
      style={{
        backgroundImage: `linear-gradient(to right, var(--muted-foreground) ${50 - dynamicSpread}%, var(--foreground) 50%, var(--muted-foreground) ${50 + dynamicSpread}%)`,
        animationDuration: `${duration}s`,
      }}
      {...props}
    >
      {children}
    </Component>
  )
}
