import { LayoutApp } from "@/app/components/layout/layout-app"
import { MessagesProvider } from "@/lib/chat-store/messages/provider"

/**
 * Persistent owner for the chat shell.
 *
 * Next.js preserves this layout while navigating between `/` and `/c/[chatId]`,
 * so the desktop sidebar's single scroll root keeps its native scroll position.
 * The mobile drawer still mounts and unmounts with the Sheet.
 *
 * header={null}: chat routes delegate the app header to Chat, which renders it
 * from the same client-state chrome decision as the surface (ADR-0017) — a
 * shallow first-turn handoff can then never strand a header-less thread.
 */
export default function ChatLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <MessagesProvider>
      <LayoutApp header={null}>{children}</LayoutApp>
    </MessagesProvider>
  )
}
