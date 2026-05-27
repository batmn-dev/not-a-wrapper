import type { UIMessage } from "ai"

type StoredAttachment = {
  name: string
  contentType: string
  url: string
}

function normalizeStoredAttachments(
  attachments?: unknown[] | null
): StoredAttachment[] | undefined {
  if (!Array.isArray(attachments)) return undefined

  const normalized = attachments
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object") return null

      const record = attachment as {
        name?: unknown
        contentType?: unknown
        url?: unknown
      }

      if (typeof record.url !== "string" || record.url.length === 0) {
        return null
      }

      return {
        name:
          typeof record.name === "string" && record.name.length > 0
            ? record.name
            : "file",
        contentType:
          typeof record.contentType === "string" &&
          record.contentType.length > 0
            ? record.contentType
            : "application/octet-stream",
        url: record.url,
      }
    })
    .filter((attachment): attachment is StoredAttachment => Boolean(attachment))

  return normalized.length > 0 ? normalized : undefined
}

export function getMessagePartsForDisplay(message: {
  content?: string | null
  parts?: unknown
  attachments?: unknown[] | null
}): UIMessage["parts"] {
  const hasStoredParts =
    Array.isArray(message.parts) && message.parts.length > 0
  const baseParts: UIMessage["parts"] = hasStoredParts
    ? (message.parts as UIMessage["parts"])
    : message.content
      ? [{ type: "text" as const, text: message.content }]
      : []

  const storedAttachments = normalizeStoredAttachments(message.attachments)
  if (!storedAttachments) return baseParts

  const hasFileParts = baseParts.some((part) => part.type === "file")
  if (hasFileParts) return baseParts

  return [
    ...baseParts,
    ...storedAttachments.map((attachment) => ({
      type: "file" as const,
      filename: attachment.name,
      mediaType: attachment.contentType,
      url: attachment.url,
    })),
  ]
}
