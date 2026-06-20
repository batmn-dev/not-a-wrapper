import { ChatContainer } from "@/app/components/chat/chat-container"
import { LayoutApp } from "@/app/components/layout/layout-app"
import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import { isLocalChatId } from "@/lib/chat-store/identity"
import { MessagesProvider } from "@/lib/chat-store/messages/provider"
import { redirect } from "next/navigation"

type Props = {
  params: Promise<{ chatId: string }>
}

export default async function Page({ params }: Props) {
  const { chatId } = await params

  if (!isLocalChatId(chatId)) {
    const authSession = await getAuthenticatedWorkosSession()

    // Redirect to home if not authenticated
    if (!authSession) {
      redirect("/")
    }
  }

  return (
    <MessagesProvider>
      <LayoutApp>
        <ChatContainer />
      </LayoutApp>
    </MessagesProvider>
  )
}
