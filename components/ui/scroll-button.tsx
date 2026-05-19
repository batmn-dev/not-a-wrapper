"use client"

import { Button, buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { ScrollRootContext } from "@/components/ui/scroll-root"
import { cn } from "@/lib/utils"
import { RiArrowDownLine } from "@remixicon/react"
import { type VariantProps } from "class-variance-authority"
import { useContext } from "react"
import { useStickToBottomContext } from "use-stick-to-bottom"

export type ScrollButtonProps = {
  className?: string
  variant?: VariantProps<typeof buttonVariants>["variant"]
  size?: VariantProps<typeof buttonVariants>["size"]
} & React.ButtonHTMLAttributes<HTMLButtonElement>

type ScrollButtonInnerProps = ScrollButtonProps & {
  isAtBottom: boolean
  scrollToBottom: () => void
}

function ScrollButtonInner({
  className,
  variant = "outline",
  size = "sm",
  isAtBottom,
  scrollToBottom,
  ...props
}: ScrollButtonInnerProps) {
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(
        "bg-popover/90 hover:bg-accent/90 dark:bg-popover/75 dark:hover:bg-accent/90 h-9 w-9 rounded-full backdrop-blur-md transition-opacity duration-150 ease-out pointer-coarse:h-10 pointer-coarse:w-10",
        !isAtBottom ? "opacity-100" : "pointer-events-none opacity-0",
        className
      )}
      onClick={() => scrollToBottom()}
      {...props}
    >
      <Icon icon={RiArrowDownLine} slotSize={20} />
    </Button>
  )
}

function LegacyScrollButton(props: ScrollButtonProps) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()
  return (
    <ScrollButtonInner
      isAtBottom={isAtBottom}
      scrollToBottom={scrollToBottom}
      {...props}
    />
  )
}

function ScrollButton(props: ScrollButtonProps) {
  const scrollRoot = useContext(ScrollRootContext)
  if (scrollRoot) {
    return (
      <ScrollButtonInner
        isAtBottom={scrollRoot.isAtBottom}
        scrollToBottom={scrollRoot.scrollToBottom}
        {...props}
      />
    )
  }
  return <LegacyScrollButton {...props} />
}

export { ScrollButton }
