"use client"

import { useChats } from "@/lib/chat-store/chats/provider"
import type { Chat } from "@/lib/chat-store/types"
import { Pin, PinOff } from "@/lib/icons"
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
  "text-[var(--text-tertiary)] hover:text-foreground/90 data-popup-open:text-foreground/90 flex h-9 w-[34px] shrink-0 items-center justify-center outline-none"

/**
 * The inner 24×24 chip that hosts the keyboard-only focus ring — ChatGPT outlines
 * this chip (1.5px, offset 2.5px, text-primary color), not the full button, and
 * only under keyboard focus. The ring itself is a CSS rule keyed off the button's
 * `:focus-visible` (see `.trailing-icon-chip` in globals.css) — same mechanism as
 * ChatGPT, and more reliable than a stacked arbitrary-property Tailwind variant.
 */
export function TrailingIconChip({ children }: { children: ReactNode }) {
  return (
    <span className="trailing-icon-chip flex size-6 items-center justify-center rounded-md">
      {children}
    </span>
  )
}

/**
 * Standalone pin/unpin quick-action, revealed alongside the options menu so the
 * trailing slot mirrors ChatGPT's pin + options pair. Lives inside the row's
 * single `<Link>`, so it cancels the anchor's navigation (preventDefault) and
 * keeps the click off the row (stopPropagation) before toggling.
 */
export function SidebarChatPinButton({
  chat,
  title,
}: {
  chat: Chat
  title: string
}) {
  const { togglePinned } = useChats()

  return (
    <button
      type="button"
      className={trailingIconButtonClassName}
      aria-label={chat.pinned ? `Unpin ${title}` : `Pin ${title}`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        togglePinned(chat.id, !chat.pinned)
      }}
    >
      <TrailingIconChip>
        {chat.pinned ? <PinOff slotSize={20} /> : <Pin slotSize={20} />}
      </TrailingIconChip>
    </button>
  )
}
