type StoredAttachment = {
  name: string
  contentType: string
  url: string
}

function normalizeStoredAttachments(attachments: unknown): StoredAttachment[] {
  if (!Array.isArray(attachments)) return []

  return attachments
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
}

export function extractTextFromMessageParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ""

  let text = ""
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      text += (part as { text: string }).text
    }
  }

  return text
}

export function normalizeMessagePartsForStorage(
  parts: unknown,
  attachments?: unknown
): unknown {
  const baseParts = parts === undefined ? [] : parts
  if (!Array.isArray(baseParts)) return baseParts

  const storedAttachments = normalizeStoredAttachments(attachments)
  if (storedAttachments.length === 0) return baseParts

  const hasFileParts = baseParts.some(
    (part) =>
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "file"
  )
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
