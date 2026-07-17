"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useChats } from "@/lib/chat-store/chats/provider"
import type { Chat } from "@/lib/chat-store/types"
import { Pin, PinFilled, PinOff, PinOffOutline } from "@/lib/icons"
import type { ReactNode } from "react"

/**
 * Shared recipe for a sidebar chat-row trailing button (ChatGPT's
 * `__menu-item-trailing-btn`): a 34×36 hit area with no background — only the
 * icon color shifts, muted→foreground, on hover / menu-open. The icon is wrapped
 * in a `TrailingIconChip` (24×24) that owns the keyboard focus ring, so the ring
 * hugs the inner chip instead of the whole button. Glyph size is unchanged (18px).
 *
 * The button carries no ring itself (`outline-none`); the keyboard focus ring
 * lives on the inner chip via a `:focus-visible` CSS rule in globals.css.
 */
export const trailingIconButtonClassName =
  "group/pin text-[var(--text-tertiary)] hover:text-foreground data-popup-open:text-foreground flex h-9 w-[34px] shrink-0 items-center justify-center outline-none"

/**
 * The inner 24×24 chip that hosts the keyboard-only focus ring — ChatGPT outlines
 * this chip (1.5px, offset 2.5px, text-primary color), not the full button, and
 * only under keyboard focus. The ring itself is a CSS rule keyed off the button's
 * `:focus-visible` (see `.trailing-icon-chip` in globals.css) — same mechanism as
 * ChatGPT, and more reliable than a stacked arbitrary-property Tailwind variant.
 */
export function TrailingIconChip({ children }: { children: ReactNode }) {
  return (
    <span className="trailing-icon-chip relative flex size-6 items-center justify-center rounded-md">
      {children}
    </span>
  )
}

/**
 * Standalone pin/unpin quick-action, revealed alongside the options menu so the
 * trailing slot mirrors ChatGPT's pin + options pair. The shared action rail
 * renders it as a sibling of the primary link; event cancellation remains a
 * harmless guard for adapters that also use it inside clickable containers.
 */
export function SidebarChatPinButton({
  chat,
  title,
}: {
  chat: Chat
  title: string
}) {
  const { togglePinned } = useChats()
  const tooltipLabel = chat.pinned ? "Unpin Chat" : "Pin Chat"

  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={`${trailingIconButtonClassName} sidebar-chat-pin-action`}
            aria-label={chat.pinned ? `Unpin ${title}` : `Pin ${title}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              togglePinned(chat.id, !chat.pinned)
            }}
          />
        }
      >
        <TrailingIconChip>
          {chat.pinned ? (
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
      <TooltipContent
        side="top"
        sideOffset={-6}
        variant="outline"
        className="text-sm font-normal"
      >
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  )
}
