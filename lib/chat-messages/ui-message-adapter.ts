import type { UIMessage } from "ai"
import { type ChatMessageMetadata } from "./branch"
import { type DurableMessageStatus } from "./durable-contract"
import { stampServerFields } from "./metadata"
import { extractTextFromMessageParts } from "./parts"

export type DurableStoredMessageLike = {
  _id: string
  clientMessageId?: string
  role: "user" | "assistant" | "system"
  content: string
  parts: unknown
  status: DurableMessageStatus
  metadata?: unknown
  error?: unknown
  generationRunId?: unknown
  requestId?: unknown
  model?: unknown
  provider?: unknown
  finishReason?: unknown
  usage?: unknown
  createdAt: number
  updatedAt?: number
}

export type DurableAdaptedUiMessage = UIMessage & {
  content: string
  createdAt: Date
  status: DurableMessageStatus
  metadata?: ChatMessageMetadata
}

type DurableStoredMessageToUiMessageOptions = {
  metadataMode?: "extended" | "runtime"
}

export function durableStoredMessageToUiMessage(
  message: DurableStoredMessageLike,
  options: DurableStoredMessageToUiMessageOptions = {}
): DurableAdaptedUiMessage {
  const parts = message.parts as UIMessage["parts"]
  const content = message.content || extractTextFromMessageParts(parts)
  // The metadata module owns the field→key projection, the extended/runtime
  // gate, the server message id stamp, and branch normalization.
  const metadata = stampServerFields(
    message.metadata,
    message,
    options.metadataMode === "runtime" ? "runtime" : "extended"
  )

  return {
    id: message.clientMessageId ?? message._id,
    role: message.role,
    content,
    createdAt: new Date(message.createdAt),
    parts,
    status: message.status,
    metadata,
  }
}
