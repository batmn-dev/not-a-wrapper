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
 * The scroll-to-bottom pill. ThreadBottomContainer owns its CSS-only visibility
 * contract from `data-scroll-from-end`; this component owns the independent
 * 120ms arrow/wave and streaming-width presentation. The sentinel in
 * ThreadScrollEdge owns both runtime attributes, with no React visibility state.
 * The pill is a pointer convenience hidden from the accessibility tree —
 * keyboard users scroll the log directly.
 */
function ScrollButton({
  className,
  variant = "secondary",
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
      data-testid="scroll-to-bottom-button"
      className={cn(
        "border-border-strong bg-popover/65 hover:bg-popover active:bg-interactive-pressed relative box-content h-8 w-8 overflow-hidden rounded-full border bg-clip-border p-0 shadow-md backdrop-blur-[2px] group-data-stream-active/scroll-root:w-10 dark:shadow-none",
        "motion-safe:transition-[width] motion-safe:duration-120 motion-safe:ease-out",
        className
      )}
      onClick={() => scrollToBottom("smooth")}
      {...props}
    >
      <span
        data-scroll-button-arrow=""
        className="absolute inset-0 flex items-center justify-center opacity-100 group-data-stream-active/scroll-root:opacity-0 motion-safe:transition-opacity motion-safe:duration-120 motion-safe:ease-out"
      >
        <Icon icon={RiArrowDownLine} slotSize={20} glyphSize={20} />
      </span>
      <span
        data-scroll-button-wave=""
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center gap-0.75 opacity-0 group-data-stream-active/scroll-root:opacity-100 motion-safe:transition-opacity motion-safe:duration-120 motion-safe:ease-out"
      >
        <span className="bg-foreground/70 size-1 rounded-full motion-safe:animate-[working-dot-wave_1s_ease-in-out_infinite]" />
        <span className="bg-foreground/70 size-1 rounded-full motion-safe:animate-[working-dot-wave_1s_ease-in-out_infinite] motion-safe:[animation-delay:100ms]" />
        <span className="bg-foreground/70 size-1 rounded-full motion-safe:animate-[working-dot-wave_1s_ease-in-out_infinite] motion-safe:[animation-delay:200ms]" />
      </span>
    </Button>
  )
}

export { ScrollButton }
