/**
 * @component Message
 * @source prompt-kit
 * @upstream https://prompt-kit.com/docs/message
 * @customized true
 * @customizations
 *   - Uses `next/dynamic` for Markdown import (code-splitting)
 *   - Removes redundant `TooltipProvider` wrapper in `MessageAction`
 *   - Not A Wrapper uses app-level TooltipProvider, reducing bundle size
 *   - Upstream wraps each MessageAction with TooltipProvider (30+ instances in a chat)
 * @upgradeNotes
 *   - Preserve dynamic import for Markdown component
 *   - Do NOT re-add TooltipProvider wrapper in MessageAction
 *   - App provides TooltipProvider at root level (layout.tsx)
 */
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import dynamic from "next/dynamic"

const Markdown = dynamic(() => import("./markdown").then((mod) => mod.Markdown))

export type MessageProps = {
  children: React.ReactNode
  className?: string
  as?: "article" | "div"
  "data-turn"?: "user" | "assistant"
  "data-turn-phase"?: string
  "data-message-id"?: string
  "data-message-author-role"?: "user" | "assistant"
} & React.HTMLProps<HTMLElement>

const Message = ({
  children,
  className,
  as = "article",
  ...props
}: MessageProps) => {
  const Tag = as as React.ElementType
  return (
    <Tag className={cn("flex gap-3", className)} {...props}>
      {children}
    </Tag>
  )
}

export type MessageAvatarProps = {
  src: string
  alt: string
  fallback?: string
  delayMs?: number
  className?: string
}

const MessageAvatar = ({
  src,
  alt,
  fallback,
  delayMs,
  className,
}: MessageAvatarProps) => {
  return (
    <Avatar className={cn("h-8 w-8 shrink-0", className)}>
      <AvatarImage src={src} alt={alt} />
      {fallback && <AvatarFallback delay={delayMs}>{fallback}</AvatarFallback>}
    </Avatar>
  )
}

export type MessageContentProps = {
  children: React.ReactNode
  markdown?: boolean
  className?: string
} & React.ComponentProps<typeof Markdown> &
  React.HTMLProps<HTMLDivElement>

const MessageContent = ({
  children,
  markdown = false,
  className,
  ...props
}: MessageContentProps) => {
  const classNames = cn(
    "rounded-lg p-2 text-foreground bg-secondary prose break-words whitespace-normal",
    className
  )

  return markdown ? (
    <Markdown className={classNames} {...props}>
      {children as string}
    </Markdown>
  ) : (
    <div className={classNames} {...props}>
      {children}
    </div>
  )
}

export type MessageActionsProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

const MessageActions = ({
  children,
  className,
  ...props
}: MessageActionsProps) => (
  <div
    className={cn("text-muted-foreground flex items-center gap-2", className)}
    {...props}
  >
    {children}
  </div>
)

/**
 * ChatGPT-parity reveal contract for user-message actions only.
 *
 * Hover waits 300ms before fading the full action family in over 300ms, while
 * focus and an open tooltip reveal it immediately. Leaving starts the 300ms
 * fade-out immediately and disables hit testing at once. Coarse pointers keep
 * the controls visible because hover is not a reliable interaction there.
 *
 * Assistant actions intentionally do not use this contract: their one-time
 * streamed reveal and settled-visible behavior live in message-assistant.tsx.
 */
const userMessageFooterRevealClassName = cn(
  "pointer-events-none opacity-0 select-none",
  "motion-safe:transition-opacity duration-300",
  "group-hover/turn-messages:delay-300",
  "group-hover/turn-messages:pointer-events-auto",
  "group-hover/turn-messages:opacity-100",
  "group-focus-within/turn-messages:pointer-events-auto",
  "group-focus-within/turn-messages:opacity-100",
  "has-[[data-state=open]]:pointer-events-auto",
  "has-[[data-state=open]]:opacity-100",
  "focus-within:transition-none hover:transition-none",
  "pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
)

export type MessageActionProps = {
  className?: string
  tooltip: React.ReactNode
  children: React.ReactElement
  side?: "top" | "bottom" | "left" | "right"
} & React.ComponentProps<typeof Tooltip>

const MessageAction = ({
  tooltip,
  children,
  className,
  side = "top",
  ...props
}: MessageActionProps) => {
  const trigger = useRender({
    defaultTagName: "button",
    render: children,
    props: mergeProps<"button">(
      {
        className:
          "cursor-pointer hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed aria-disabled:cursor-not-allowed data-disabled:cursor-not-allowed",
        type: "button",
      },
      {}
    ),
  })

  return (
    <Tooltip disableHoverablePopup {...props}>
      <TooltipTrigger render={trigger} />
      <TooltipContent side={side} className={className}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

export {
  Message,
  MessageAvatar,
  MessageContent,
  MessageActions,
  MessageAction,
  userMessageFooterRevealClassName,
}
