import type { UIMessage } from "ai"
import { type ChatMessageMetadata } from "./branch"
import { stampServerFields } from "./metadata"
import {
  type DurableMessageStatus,
  isDurableMessageStatus,
} from "./durable-contract"
import { extractTextFromMessageParts, getMessagePartsForDisplay } from "./parts"

export type DurableStoredMessageLike = {
  _id: string
  clientMessageId?: string
  role?: unknown
  content?: string | null
  parts?: unknown
  attachments?: unknown[] | null
  status?: unknown
  metadata?: unknown
  error?: unknown
  generationRunId?: unknown
  requestId?: unknown
  model?: unknown
  provider?: unknown
  finishReason?: unknown
  usage?: unknown
  createdAt?: number
  updatedAt?: number
}

export type DurableAdaptedUiMessage = UIMessage & {
  content: string
  createdAt?: Date
  status?: DurableMessageStatus
  metadata?: ChatMessageMetadata
}

type DurableStoredMessageToUiMessageOptions = {
  partsMode?: "display" | "stored"
  metadataMode?: "extended" | "runtime"
}

function toUiRole(role: unknown): UIMessage["role"] {
  if (role === "data") return "system"
  if (role === "user" || role === "assistant" || role === "system") {
    return role
  }
  return "system"
}

export function durableStoredMessageToUiMessage(
  message: DurableStoredMessageLike,
  options: DurableStoredMessageToUiMessageOptions = {}
): DurableAdaptedUiMessage {
  const parts =
    options.partsMode === "stored"
      ? (message.parts as UIMessage["parts"])
      : getMessagePartsForDisplay({
          content: message.content,
          parts: message.parts,
          attachments: message.attachments,
        })
  const content =
    typeof message.content === "string"
      ? message.content
      : extractTextFromMessageParts(parts)
  // The metadata module owns the field→key projection, the extended/runtime
  // gate, the server message id stamp, and branch normalization.
  const metadata = stampServerFields(
    message.metadata,
    message,
    options.metadataMode === "runtime" ? "runtime" : "extended"
  )

  return {
    id: message.clientMessageId ?? message._id,
    role: toUiRole(message.role),
    content,
    ...(typeof message.createdAt === "number"
      ? { createdAt: new Date(message.createdAt) }
      : {}),
    parts,
    ...(isDurableMessageStatus(message.status)
      ? { status: message.status }
      : {}),
    metadata,
  }
}
