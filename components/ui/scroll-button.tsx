"use client"

import { Button, buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { ScrollRootContext } from "@/components/ui/scroll-root"
import { cn } from "@/lib/utils"
import { RiArrowDownLine } from "@remixicon/react"
import { type VariantProps } from "class-variance-authority"
import { useContext } from "react"

export type ScrollButtonProps = {
  className?: string
  variant?: VariantProps<typeof buttonVariants>["variant"]
  size?: VariantProps<typeof buttonVariants>["size"]
} & React.ButtonHTMLAttributes<HTMLButtonElement>

/**
 * The scroll-to-bottom pill. Visibility is pure CSS, ChatGPT-verbatim
 * (extracted from their conversation chunk): shown whenever the scroll root
 * carries `data-scroll-from-end` (a 300ms-delayed 300ms entrance), hidden
 * otherwise (fast 100ms exit, scaled down and nudged toward the composer).
 * The sentinel in ThreadScrollEdge owns the attribute; no React state here.
 * Like ChatGPT's, the pill is a pointer convenience hidden from the
 * accessibility tree — keyboard users scroll the log directly.
 */
function ScrollButton({
  className,
  variant = "outline",
  size = "sm",
  ...props
}: ScrollButtonProps) {
  const scrollRoot = useContext(ScrollRootContext)
  if (!scrollRoot) return null
  const { scrollToBottom } = scrollRoot
  return (
    <Button
      aria-hidden
      tabIndex={-1}
      variant={variant}
      size={size}
      className={cn(
        "bg-popover/90 hover:bg-accent/90 dark:bg-popover/75 dark:hover:bg-accent/90 h-9 w-9 rounded-full backdrop-blur-md pointer-coarse:h-10 pointer-coarse:w-10",
        "motion-safe:transition-all motion-safe:delay-300 motion-safe:duration-300",
        "group-[:not([data-scroll-from-end])]/scroll-root:pointer-events-none group-[:not([data-scroll-from-end])]/scroll-root:translate-y-2 group-[:not([data-scroll-from-end])]/scroll-root:scale-50 group-[:not([data-scroll-from-end])]/scroll-root:opacity-0 group-[:not([data-scroll-from-end])]/scroll-root:duration-100 group-[:not([data-scroll-from-end])]/scroll-root:delay-0",
        className
      )}
      onClick={() => scrollToBottom("smooth")}
      {...props}
    >
      <Icon icon={RiArrowDownLine} slotSize={20} glyphSize={22} />
    </Button>
  )
}

export { ScrollButton }
