import type { UIMessage } from "ai"
import {
  type ChatMessageMetadata,
  parseMessageBranchInfo,
} from "./branch"
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

function metadataRecord(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {}
  }
  return metadata as Record<string, unknown>
}

function setIfDefined(
  target: Record<string, unknown>,
  key: string,
  value: unknown
) {
  if (value !== undefined) target[key] = value
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
  const metadata = {
    ...metadataRecord(message.metadata),
  }

  metadata.serverMessageId = message._id
  setIfDefined(metadata, "durableStatus", message.status)
  if (options.metadataMode === "runtime") {
    if (message.error) metadata.durableError = message.error
  } else {
    setIfDefined(metadata, "durableError", message.error)
    setIfDefined(metadata, "generationRunId", message.generationRunId)
    setIfDefined(metadata, "requestId", message.requestId)
    setIfDefined(metadata, "model", message.model)
    setIfDefined(metadata, "provider", message.provider)
    setIfDefined(metadata, "finishReason", message.finishReason)
    setIfDefined(metadata, "usage", message.usage)
  }

  // Normalize the transient server-attached branch descriptor into the typed
  // client shape so renderers read it as first-class state, not via casts.
  if ("branch" in metadata) {
    const branch = parseMessageBranchInfo(metadata.branch)
    if (branch) metadata.branch = branch
    else delete metadata.branch
  }

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
