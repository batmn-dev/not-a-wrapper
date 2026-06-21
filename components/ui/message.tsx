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
  'data-turn'?: 'user' | 'assistant'
  'data-message-id'?: string
} & React.HTMLProps<HTMLElement>

const Message = ({ children, className, ...props }: MessageProps) => (
  <article className={cn("flex gap-3", className)} {...props}>
    {children}
  </article>
)

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
      {fallback && (
        <AvatarFallback delay={delayMs}>{fallback}</AvatarFallback>
      )}
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
 * Shared reveal styling for message footer action rows (assistant + user) so
 * the hover effect is identical across both surfaces. Compose it into a
 * footer's className alongside that surface's own layout classes.
 *
 * The controls stay mounted and hit-testable — `pointer-events-auto` so the
 * cursor resolves to `pointer` the instant it's over a button — and fade in
 * via a quick 0.2s mask-position slide when the turn is hovered, focused, or
 * has an open menu. Touch devices (no hover) drop the mask and show the
 * controls outright; reduced-motion users get the reveal without the slide.
 */
const messageFooterRevealClassName = cn(
  "pointer-events-auto",
  "[mask-image:linear-gradient(to_right,black_33%,transparent_66%)]",
  "[mask-size:300%_100%]",
  "[mask-position:100%_0%]",
  "motion-safe:transition-[mask-position]",
  "duration-[0.2s]",
  "group-hover/turn-messages:[mask-position:0_0]",
  "group-focus-within/turn-messages:[mask-position:0_0]",
  "has-[[data-state=open]]:[mask-position:0_0]",
  "pointer-coarse:[mask-image:none]"
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
  messageFooterRevealClassName,
}
