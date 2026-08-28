import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import { isLocalChatId } from "@/lib/chat-store/identity"
import { redirect } from "next/navigation"

type Props = {
  params: Promise<{ chatId: string }>
}

// The Chat surface is mounted by the persistent (chat)/layout.tsx — see its
// header comment (adoption-loss fix). This segment keeps only the server
// duty: direct loads of a durable chat require a WorkOS session.
export default async function Page({ params }: Props) {
  const { chatId } = await params

  if (!isLocalChatId(chatId)) {
    const authSession = await getAuthenticatedWorkosSession()

    if (!authSession) {
      redirect("/")
    }
  }

  return null
}
