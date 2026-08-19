"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Pin, PinFilled, PinOff, PinOffOutline } from "@/lib/icons"
import type { ReactNode } from "react"

/**
 * Shared recipe for a sidebar row's trailing button: a 34×36 hit area with no
 * background. Only the
 * icon color shifts, muted→foreground, on hover / menu-open. The icon is wrapped
 * in a `TrailingIconChip` (24×24) that owns the keyboard focus ring, so the ring
 * hugs the inner chip instead of the whole button. Glyph size is unchanged (18px).
 *
 * The button carries no ring itself (`outline-none`); the keyboard focus ring
 * lives on the inner chip via a `:focus-visible` CSS rule in globals.css.
 */
export const trailingIconButtonClassName =
  "sidebar-row-trailing-button group/pin text-[var(--text-tertiary)] hover:text-foreground data-popup-open:text-foreground flex shrink-0 items-center justify-center outline-none"

/**
 * The inner 24×24 chip hosts the keyboard-only focus ring (1.5px, offset 2.5px,
 * text-primary color), not the full button, and
 * only under keyboard focus. The ring itself is a CSS rule keyed off the button's
 * `:focus-visible` (see `.trailing-icon-chip` in globals.css).
 */
export function TrailingIconChip({ children }: { children: ReactNode }) {
  return (
    <span className="trailing-icon-chip relative flex size-6 items-center justify-center rounded-md">
      {children}
    </span>
  )
}

type SidebarPinActionProps = {
  pinned: boolean
  title: string
  itemType: "Chat" | "Component" | "Project"
  onTogglePinned: () => void
  isPending?: boolean
}

/**
 * Source of truth for the pin action in every sidebar content row.
 *
 * Keeping both states in this component makes Pin/Unpin the stable first action
 * for chats and projects instead of letting each row invent its own affordance.
 */
export function SidebarPinAction({
  pinned,
  title,
  itemType,
  onTogglePinned,
  isPending = false,
}: SidebarPinActionProps) {
  const actionLabel = pinned ? `Unpin ${itemType}` : `Pin ${itemType}`

  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={`${trailingIconButtonClassName} sidebar-chat-pin-action`}
            aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
            disabled={isPending}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onTogglePinned()
            }}
          />
        }
      >
        <TrailingIconChip>
          {pinned ? (
            <>
              <PinOffOutline
                slotSize={20}
                className="absolute group-hover/pin:opacity-0 group-focus-visible/pin:opacity-0"
              />
              <PinOff
                slotSize={20}
                className="absolute opacity-0 group-hover/pin:opacity-100 group-focus-visible/pin:opacity-100"
              />
            </>
          ) : (
            <>
              <Pin
                slotSize={20}
                className="absolute group-hover/pin:opacity-0 group-focus-visible/pin:opacity-0"
              />
              <PinFilled
                slotSize={20}
                className="absolute opacity-0 group-hover/pin:opacity-100 group-focus-visible/pin:opacity-100"
              />
            </>
          )}
        </TrailingIconChip>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={-6} variant="outline">
        {actionLabel}
      </TooltipContent>
    </Tooltip>
  )
}
