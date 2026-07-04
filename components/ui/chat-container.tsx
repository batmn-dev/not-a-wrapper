"use client"

import { ScrollButton } from "@/components/ui/scroll-button"
import { cn } from "@/lib/utils"
import { StickToBottom } from "use-stick-to-bottom"

export type ChatContainerRootProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>

export type ChatContainerContentProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>

export type ChatContainerScrollAnchorProps = {
  className?: string
  ref?: React.RefObject<HTMLDivElement>
} & React.HTMLAttributes<HTMLDivElement>

function ChatContainerRoot({
  children,
  className,
  ...props
}: ChatContainerRootProps) {
  return (
    <StickToBottom
      className={cn("relative flex overflow-y-auto", className)}
      resize="smooth"
      initial="instant"
      role="log"
      {...props}
    >
      {children}
    </StickToBottom>
  )
}

function ChatContainerContent({
  children,
  className,
  ...props
}: ChatContainerContentProps) {
  return (
    <StickToBottom.Content
      className={cn("flex w-full flex-col", className)}
      {...props}
    >
      {children}
    </StickToBottom.Content>
  )
}

function ChatContainerScrollAnchor({
  className,
  ...props
}: ChatContainerScrollAnchorProps) {
  return (
    <div
      className={cn("h-px w-full shrink-0 scroll-mt-4", className)}
      aria-hidden="true"
      {...props}
    />
  )
}

type ChatContainerScrollButtonProps = {
  className?: string
}

function ChatContainerScrollButton({
  className,
}: ChatContainerScrollButtonProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-6 z-10 flex items-center justify-center",
        className
      )}
    >
      <div className="pointer-events-auto">
        <ScrollButton />
      </div>
    </div>
  )
}

export {
  ChatContainerRoot,
  ChatContainerContent,
  ChatContainerScrollAnchor,
  ChatContainerScrollButton,
}
