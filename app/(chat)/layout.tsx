import { Chat } from "@/app/components/chat/chat"
import {
  ChatChromeHeader,
  ChatChromeProvider,
} from "@/app/components/chat/chat-chrome-host"
import { LayoutApp } from "@/app/components/layout/layout-app"
import { MessagesProvider } from "@/lib/chat-store/messages/provider"

/**
 * Persistent owner for the shell, Chat surface, and header slot.
 *
 * Next.js preserves this layout while navigating between `/` and `/c/[chatId]`,
 * preserving the stream owner and desktop scroll root across segment commits
 * (ADR-0013). The segment pages keep only server duties and render null.
 * ChatChromeHeader stays before `<main>` for the skip-link and banner contract
 * (ADR-0017).
 */
export default function ChatLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <MessagesProvider>
      <ChatChromeProvider initialAppHeader initialFixedHeader="less-than-xl">
        <LayoutApp header={<ChatChromeHeader />}>
          <Chat />
          {children}
        </LayoutApp>
      </ChatChromeProvider>
    </MessagesProvider>
  )
}
