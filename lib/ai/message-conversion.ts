/**
 * AI SDK Attachment Conversion Utilities
 *
 * Converts uploaded attachments into file parts for `sendMessage`.
 */
export function convertAttachmentsToFiles(
  attachments?: Array<{
    name: string
    contentType: string
    url: string
    attachmentId?: string
  }>
):
  | Array<{
      type: "file"
      filename: string
      mediaType: string
      url: string
      attachmentId?: string
    }>
  | undefined {
  if (!attachments?.length) return undefined
  return attachments.map((att) => ({
    type: "file" as const,
    filename: att.name,
    mediaType: att.contentType,
    url: att.url,
    ...(att.attachmentId ? { attachmentId: att.attachmentId } : {}),
  }))
}
