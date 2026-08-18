import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { APP_DOMAIN } from "@/lib/config"
import { ConvexHttpClient } from "convex/browser"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Article from "./article"

export const dynamic = "force-dynamic"

function getConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL is not set. Please configure it in your environment variables."
    )
  }
  return new ConvexHttpClient(url)
}

function toConvexId(chatId: string): Id<"chats"> | null {
  if (!chatId || chatId.length < 10) return null
  try {
    return chatId as Id<"chats">
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ chatId: string }>
}): Promise<Metadata> {
  const { chatId } = await params
  const convexId = toConvexId(chatId)

  let title = "Shared Chat"
  let description = "A conversation in Not A Wrapper"

  if (convexId) {
    try {
      const convex = getConvexClient()
      const chat = await convex.query(api.chats.getPublicById, {
        chatId: convexId,
      })
      if (chat?.title) {
        title = chat.title
        description = `Read this conversation: ${chat.title}`
      }
    } catch {
    }
  }

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: `${APP_DOMAIN}/share/${chatId}`,
      images: [],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [],
    },
  }
}

export default async function ShareChat({
  params,
}: {
  params: Promise<{ chatId: string }>
}) {
  const { chatId } = await params
  const convexId = toConvexId(chatId)

  if (!convexId) {
    notFound()
  }

  // Wrap in try/catch because toConvexId only does basic length validation—
  // invalid ID formats will cause Convex to throw
  const convex = getConvexClient()
  let chat, messages
  try {
    ;[chat, messages] = await Promise.all([
      convex.query(api.chats.getPublicById, { chatId: convexId }),
      convex.query(api.messages.getPublicForChat, { chatId: convexId }),
    ])
  } catch {
    // Invalid Convex ID format or other query error → 404
    notFound()
  }

  if (!chat) {
    notFound()
  }

  return (
    <Article
      messages={messages}
      date={new Date(chat._creationTime).toISOString()}
      title={chat.title ?? "Shared Chat"}
      subtitle="A conversation in Not A Wrapper"
    />
  )
}
