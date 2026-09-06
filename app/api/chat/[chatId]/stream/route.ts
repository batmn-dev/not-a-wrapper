import { api } from "@/convex/_generated/api"
import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import { durableStoredMessageToUiMessage } from "@/lib/chat-messages/ui-message-adapter"
import { readRetainedChatStream } from "@/lib/chat-stream/server"
import { fetchQuery } from "convex/nextjs"

export const maxDuration = 300

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const session = await getAuthenticatedWorkosSession()
  if (!session) return new Response(null, { status: 401 })
  const { chatId } = await params
  const runId = new URL(request.url).searchParams.get("runId")
  const options = { token: session.accessToken }
  const [run, path] = await Promise.all([
    fetchQuery(api.messages.getSelectedRunState, { chatId }, options),
    fetchQuery(api.messages.getSelectedPath, { chatId }, options),
  ])
  if (
    !run ||
    (runId !== null && run.runId !== runId) ||
    !path.selectedMessages.some(
      (message) => message._id === run.assistantMessageId
    )
  )
    return new Response(null, { status: 404 })

  if (
    runId === null &&
    !["queued", "running", "streaming"].includes(run.status)
  )
    return new Response(null, { status: 204 })

  const stream = await readRetainedChatStream(run.runId, {
    signal: request.signal,
  })
  if (!stream) {
    // Preparation can precede Redis initialization. A live run is retryable.
    const live = ["queued", "running", "streaming"].includes(run.status)
    return new Response(null, {
      status: live ? 503 : 204,
      headers: { "Retry-After": "1" },
    })
  }
  const selection = new TextEncoder().encode(
    `${JSON.stringify({
      type: "selection",
      runId: run.runId,
      assistantMessageId: run.assistantMessageId,
      messages: path.selectedMessages.map((message) =>
        durableStoredMessageToUiMessage(message)
      ),
    })}\n`
  )
  return new Response(
    stream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        start(controller) {
          controller.enqueue(selection)
        },
        transform(chunk, controller) {
          controller.enqueue(chunk)
        },
      })
    ),
    {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "private, no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    }
  )
}
