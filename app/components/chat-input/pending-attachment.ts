import type { Attachment } from "@/lib/file-handling"

export type PendingAttachmentStatus = "uploading" | "ready" | "failed"

type AttachmentBase = {
  id: string
  file: File
  signature: string
}

type SelectedFileBase = AttachmentBase & { kind: "selected-file" }

type GeneratedLargePasteBase = AttachmentBase & {
  kind: "generated-large-paste"
  text: string
  characterCount: number
  preview: string
  delivery: "upload" | "inline"
}

type AttachmentKindBase = SelectedFileBase | GeneratedLargePasteBase

export type UploadingAttachment = AttachmentKindBase & {
  status: "uploading"
  attemptId: number
  progress?: number
}

export type ReadyAttachment = AttachmentKindBase & {
  status: "ready"
  /** Null only for generated paste text delivered inline rather than uploaded. */
  uploaded: Attachment | null
}

export type FailedAttachment = AttachmentKindBase & {
  status: "failed"
  attemptId: number
  error: string
  retryable: boolean
}

export type PendingAttachment =
  UploadingAttachment | ReadyAttachment | FailedAttachment

export type GeneratedLargePasteAttachment = Extract<
  PendingAttachment,
  { kind: "generated-large-paste" }
>

function createPendingAttachmentId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `pending-attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

export function getFileSignature(file: File): string {
  return [file.name, file.size, file.type, file.lastModified].join("\u0000")
}

export function createSelectedFileAttachment(
  file: File,
  attemptId = 1
): UploadingAttachment {
  return {
    id: createPendingAttachmentId(),
    kind: "selected-file",
    status: "uploading",
    attemptId,
    signature: getFileSignature(file),
    file,
  }
}

export function createGeneratedLargePasteAttachment(
  text: string,
  sequence: number,
  delivery: "upload" | "inline" = "inline"
): GeneratedLargePasteAttachment {
  const preview = `${text.slice(0, 20)}${text.length > 20 ? "…" : ""}`
  const file = new File([text], `Pasted text ${sequence}.txt`, {
    type: "text/plain",
  })
  const base: GeneratedLargePasteBase = {
    id: createPendingAttachmentId(),
    kind: "generated-large-paste",
    signature: getFileSignature(file),
    file,
    text,
    characterCount: text.length,
    preview,
    delivery,
  }
  return delivery === "upload"
    ? { ...base, status: "uploading", attemptId: 1 }
    : { ...base, status: "ready", uploaded: null }
}

function attachmentBase(attachment: PendingAttachment): AttachmentKindBase {
  if (attachment.status === "ready") {
    const { status: _status, uploaded: _uploaded, ...base } = attachment
    return base
  }
  if (attachment.status === "failed") {
    const {
      status: _status,
      attemptId: _attemptId,
      error: _error,
      retryable: _retryable,
      ...base
    } = attachment
    return base
  }
  const {
    status: _status,
    attemptId: _attemptId,
    progress: _progress,
    ...base
  } = attachment
  return base
}

export function markAttachmentUploading(
  attachment: PendingAttachment,
  attemptId: number
): UploadingAttachment {
  return { ...attachmentBase(attachment), status: "uploading", attemptId }
}

export function markAttachmentReady(
  attachment: PendingAttachment,
  uploaded: Attachment
): ReadyAttachment {
  return { ...attachmentBase(attachment), status: "ready", uploaded }
}

export function markAttachmentFailed(
  attachment: PendingAttachment,
  attemptId: number,
  error: string,
  retryable = true
): FailedAttachment {
  return {
    ...attachmentBase(attachment),
    status: "failed",
    attemptId,
    error,
    retryable,
  }
}

export function getPendingAttachmentVariant(
  attachment: PendingAttachment
): "generated-text" | "document" | "image" {
  if (attachment.kind === "generated-large-paste") return "generated-text"
  return attachment.file.type.startsWith("image/") ? "image" : "document"
}

export function getPendingAttachmentLabel(
  attachment: PendingAttachment
): string {
  return attachment.kind === "generated-large-paste"
    ? attachment.preview
    : attachment.file.name
}

export function restoreLargePasteText(
  existingText: string,
  attachment: GeneratedLargePasteAttachment
): { text: string; selectionStart: number; selectionEnd: number } {
  const text = `${existingText}${attachment.text}`
  return { text, selectionStart: text.length, selectionEnd: text.length }
}

export function assembleComposerTurnPayload({
  text,
  attachments,
}: {
  text: string
  attachments: readonly PendingAttachment[]
}): { text: string; files: File[]; attachments: Attachment[] } {
  const inlinePastes = attachments.filter(
    (attachment): attachment is GeneratedLargePasteAttachment =>
      attachment.kind === "generated-large-paste" &&
      attachment.delivery === "inline"
  )
  const ready = attachments.filter(
    (attachment): attachment is ReadyAttachment => attachment.status === "ready"
  )
  return {
    text: [text, ...inlinePastes.map((attachment) => attachment.text)]
      .filter((part) => part.length > 0)
      .join("\n\n"),
    files: ready
      .filter((attachment) => attachment.uploaded !== null)
      .map((attachment) => attachment.file),
    attachments: ready.flatMap((attachment) =>
      attachment.uploaded ? [attachment.uploaded] : []
    ),
  }
}
