import { Chat } from "@/app/components/chat/chat"
import {
  ChatChromeHeader,
  ChatChromeProvider,
} from "@/app/components/chat/chat-chrome-host"
import { LayoutApp } from "@/app/components/layout/layout-app"
import { MessagesProvider } from "@/lib/chat-store/messages/provider"

/**
 * Persistent owner for the chat shell — AND the Chat surface itself.
 *
 * Next.js preserves this layout while navigating between `/` and `/c/[chatId]`,
 * so the desktop sidebar's single scroll root keeps its native scroll position.
 * The mobile drawer still mounts and unmounts with the Sheet.
 *
 * `<Chat/>` is mounted HERE, not in the two page segments (adoption-loss
 * investigation, 2026-08-28): both pages rendered an identical `<Chat/>`, and
 * the first-turn shallow pushState handoff bet that the router would never
 * commit the `/c/[chatId]` segment mid-stream. Intermittently (~7% of first
 * sends) Next did commit it 30–90 ms after the push — the page subtree swap
 * remounted Chat, the fresh instance's per-instance stream owner (ADR-0013)
 * could not see the live binding, and the turn silently degraded to 750 ms
 * snapshot rendering while the orphaned stream kept streaming into nothing.
 * With Chat owned by the persistent layout, a segment commit reconciles
 * around it and can never unmount the live stream. The pages keep only their
 * server duties (the /c auth redirect) and render null. Chat reads its route
 * identity from ChatSessionProvider, so it needs nothing from the segments.
 *
 * The header slot receives ChatChromeHeader: Chat decides header visibility
 * from its chrome resolver (ADR-0017) while the shell keeps the header's DOM
 * before the <main> landmark (skip link + banner role). `/` and `/c/` always
 * mount with the header, hence initialAppHeader.
 */
export default function ChatLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <MessagesProvider>
      <ChatChromeProvider initialAppHeader initialFixedHeader="always">
        <LayoutApp header={<ChatChromeHeader />}>
          <Chat />
          {children}
        </LayoutApp>
      </ChatChromeProvider>
    </MessagesProvider>
  )
}
