import { Chat } from "@/app/components/chat/chat"
import {
  ChatChromeHeader,
  ChatChromeProvider,
} from "@/app/components/chat/chat-chrome-host"
import { LayoutApp } from "@/app/components/layout/layout-app"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import { MessagesProvider } from "@/lib/chat-store/messages/provider"
import { ConvexHttpClient } from "convex/browser"
import { notFound, redirect } from "next/navigation"

function getConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL is not set. Please configure it in your environment variables."
    )
  }
  return new ConvexHttpClient(url)
}

type Props = {
  params: Promise<{ projectId: string }>
}

function toConvexId(projectId: string): Id<"projects"> | null {
  if (!projectId || projectId.length < 10) return null
  try {
    return projectId as Id<"projects">
  } catch {
    return null
  }
}

export default async function Page({ params }: Props) {
  const { projectId } = await params
  const authSession = await getAuthenticatedWorkosSession()

  if (!authSession) {
    redirect("/")
  }

  const convexId = toConvexId(projectId)
  if (!convexId) {
    notFound()
  }

  let project
  try {
    const convex = getConvexClient()
    convex.setAuth(authSession.accessToken)

    project = await convex.query(api.projects.getById, {
      projectId: convexId,
    })
  } catch {
    notFound()
  }

  // getById returns null if: project doesn't exist OR user doesn't own it
  // This is intentional - we don't reveal project existence to non-owners
  if (!project) {
    notFound()
  }

  return (
    <MessagesProvider>
      {/* initialAppHeader={false}: /p/ always mounts as project onboarding,
          which owns its chrome (no app header). Chat publishes the flip to
          the shell's pre-<main> header slot after a first send (ADR-0017). */}
      <ChatChromeProvider
        initialAppHeader={false}
        initialFixedHeader="less-than-xl"
      >
        <LayoutApp header={<ChatChromeHeader />}>
          {/* The project surface IS the Chat surface: the first turn allocates
            its chat (with projectId) inside the accepted turn and hands off
            the route shallowly — same pipeline as home. */}
          <Chat
            project={{
              id: project._id,
              name: project.name,
              pinned: project.pinned,
            }}
            key={projectId}
          />
        </LayoutApp>
      </ChatChromeProvider>
    </MessagesProvider>
  )
}
