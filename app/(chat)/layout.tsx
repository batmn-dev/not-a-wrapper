import { LayoutApp } from "@/app/components/layout/layout-app"
import { MessagesProvider } from "@/lib/chat-store/messages/provider"

/**
 * Persistent owner for the chat shell.
 *
 * Next.js preserves this layout while navigating between `/` and `/c/[chatId]`,
 * so the desktop sidebar's single scroll root keeps its native scroll position.
 * The mobile drawer still mounts and unmounts with the Sheet.
 */
export default function ChatLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <MessagesProvider>
      <LayoutApp>{children}</LayoutApp>
    </MessagesProvider>
  )
}
