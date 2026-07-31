import {
  ChatChromeHeader,
  ChatChromeProvider,
} from "@/app/components/chat/chat-chrome-host"
import { LayoutApp } from "@/app/components/layout/layout-app"
import { MessagesProvider } from "@/lib/chat-store/messages/provider"

/**
 * Persistent owner for the chat shell.
 *
 * Next.js preserves this layout while navigating between `/` and `/c/[chatId]`,
 * so the desktop sidebar's single scroll root keeps its native scroll position.
 * The mobile drawer still mounts and unmounts with the Sheet.
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
      <ChatChromeProvider initialAppHeader>
        <LayoutApp header={<ChatChromeHeader />}>{children}</LayoutApp>
      </ChatChromeProvider>
    </MessagesProvider>
  )
}
