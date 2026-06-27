import {
  getStaticToolName,
  isStaticToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai"

type StoredAttachment = {
  name: string
  contentType: string
  url: string
}

function isFilePart(part: unknown): boolean {
  return (
    Boolean(part) &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "file"
  )
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

function serializeToolRenderValue(value: unknown): string {
  if (typeof value === "undefined") return "undefined"

  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function getToolRenderValueSignature(
  part: ToolUIPart,
  key: "input" | "output"
): string {
  if (key === "input") return serializeToolRenderValue(part.input)
  if (part.state === "output-available") {
    return serializeToolRenderValue(part.output)
  }
  return ""
}

export function getToolRenderSignature(
  parts: UIMessage["parts"] | undefined
): string {
  if (!parts) return ""

  const signatures: Array<[string, string, string, string]> = []
  for (const part of parts) {
    if (isStaticToolUIPart(part)) {
      signatures.push([
        getStaticToolName(part),
        part.state,
        getToolRenderValueSignature(part, "input"),
        getToolRenderValueSignature(part, "output"),
      ])
    }
  }

  return JSON.stringify(signatures)
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

  const hasFileParts = baseParts.some(isFilePart)
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
