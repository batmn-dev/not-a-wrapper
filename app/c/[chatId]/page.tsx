import { ChatContainer } from "@/app/components/chat/chat-container"
import { LayoutApp } from "@/app/components/layout/layout-app"
import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import { MessagesProvider } from "@/lib/chat-store/messages/provider"
import { redirect } from "next/navigation"

export default async function Page() {
  const authSession = await getAuthenticatedWorkosSession()
  
  // Redirect to home if not authenticated
  if (!authSession) {
    redirect("/")
  }

  return (
    <MessagesProvider>
      <LayoutApp>
        <ChatContainer />
      </LayoutApp>
    </MessagesProvider>
  )
}
