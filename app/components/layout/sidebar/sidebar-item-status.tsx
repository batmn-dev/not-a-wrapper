import type { SidebarChatStatus } from "@/lib/chat-store/status/sidebar-chat-status"
import { cn } from "@/lib/utils"

const STATUS_LABEL: Record<Exclude<SidebarChatStatus, "idle">, string> = {
  streaming: "Generating response",
  awaiting: "Waiting for you",
  unread: "New activity",
  error: "Generation failed",
}

type SidebarChatStatusIndicatorProps = {
  status: SidebarChatStatus
  className?: string
}

/**
 * The leading-slot indicator for a sidebar chat row (ChatGPT's dynamic slot).
 * Renders nothing when `idle` so the row's title reclaims the full width — the
 * caller can drop this straight into the title flex and rely on `gap` only
 * showing up when an indicator is present.
 *
 * The slot is a fixed 16px square (ChatGPT sizes it to `icon-sm`) so the title
 * baseline never shifts as the indicator swaps between a ring and a dot.
 */
export function SidebarChatStatusIndicator({
  status,
  className,
}: SidebarChatStatusIndicatorProps) {
  if (status === "idle") return null

  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center",
        className
      )}
    >
      {status === "streaming" ? (
        // Rotating ring — muted/tertiary to match ChatGPT's subtle spinner.
        <span
          className="text-muted-foreground size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
          aria-hidden
        />
      ) : status === "awaiting" ? (
        // Pulsing amber dot — a clear "needs your attention" cue while blocked
        // on the user (e.g. tool-call approval).
        <span
          className="bg-warning size-2 animate-pulse rounded-full"
          aria-hidden
        />
      ) : status === "error" ? (
        <span className="bg-destructive size-2 rounded-full" aria-hidden />
      ) : (
        // unread / just finished — a solid blue dot, matching ChatGPT.
        <span className="bg-info size-2 rounded-full" aria-hidden />
      )}
      <span className="sr-only">{STATUS_LABEL[status]}</span>
    </span>
  )
}
