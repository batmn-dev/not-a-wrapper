import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import { toast } from "@/components/ui/toast"
import {
  checkFileUploadLimit,
  deleteUploadedAttachment,
  FileUploadLimitError,
  uploadStagedFile,
  type Attachment,
} from "@/lib/file-handling"
import { validateFile } from "@/lib/file/validation"
import type { ConvexReactClient } from "convex/react"
import { useCallback, useRef, useState } from "react"
import {
  createGeneratedLargePasteAttachment,
  createSelectedFileAttachment,
  getFileSignature,
  markAttachmentFailed,
  markAttachmentReady,
  markAttachmentUploading,
  type PendingAttachment,
} from "../chat-input/pending-attachment"

type ActiveUpload = { attemptId: number; controller: AbortController }

type FilePickerOptions = {
  convex: ConvexReactClient
  uploadGeneratedPastes: boolean
}

function uploadFailure(error: unknown): {
  message: string
  retryable: boolean
} {
  const message = error instanceof Error ? error.message : ""
  if (
    error instanceof FileUploadLimitError ||
    /daily file upload limit reached/i.test(message)
  ) {
    return { message: "Daily file upload limit reached.", retryable: false }
  }
  if (/\[CONVEX\b|Uncaught Error:/i.test(message)) {
    return { message: "Upload failed. Please try again.", retryable: true }
  }
  return { message: message || "Upload failed", retryable: true }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

export const useFilePickerState = ({
  convex,
  uploadGeneratedPastes,
}: FilePickerOptions) => {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [lockedAttachmentIds, setLockedAttachmentIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const [announcement, setAnnouncement] = useState("")
  const attachmentsRef = useRef<PendingAttachment[]>([])
  const lockedAttachmentIdsRef = useRef<ReadonlySet<string>>(new Set())
  const activeUploadsRef = useRef(new Map<string, ActiveUpload>())
  const generatedPasteSequenceRef = useRef(0)

  const updateAttachments = useCallback(
    (
      update: (current: PendingAttachment[]) => PendingAttachment[]
    ): PendingAttachment[] => {
      const next = update(attachmentsRef.current)
      attachmentsRef.current = next
      setAttachments(next)
      return next
    },
    []
  )

  const startUpload = useCallback(
    (attachment: PendingAttachment, attemptId: number) => {
      const controller = new AbortController()
      activeUploadsRef.current.set(attachment.id, { attemptId, controller })

      void uploadStagedFile(convex, attachment.file, {
        signal: controller.signal,
        onProgress: ({ percent }) => {
          updateAttachments((current) =>
            current.map((candidate) =>
              candidate.id === attachment.id &&
              candidate.status === "uploading" &&
              candidate.attemptId === attemptId
                ? { ...candidate, progress: percent }
                : candidate
            )
          )
        },
      })
        .then(({ fileUrl, attachmentId }) => {
          const active = activeUploadsRef.current.get(attachment.id)
          if (!active || active.attemptId !== attemptId) {
            void deleteUploadedAttachment(convex, attachmentId)
            return
          }
          activeUploadsRef.current.delete(attachment.id)
          updateAttachments((current) =>
            current.map((candidate) =>
              candidate.id === attachment.id &&
              candidate.status === "uploading" &&
              candidate.attemptId === attemptId
                ? markAttachmentReady(candidate, {
                    name: candidate.file.name,
                    contentType: candidate.file.type,
                    url: fileUrl,
                    attachmentId,
                  })
                : candidate
            )
          )
          setAnnouncement(`${attachment.file.name} upload complete.`)
        })
        .catch((error: unknown) => {
          const active = activeUploadsRef.current.get(attachment.id)
          if (!active || active.attemptId !== attemptId) return
          activeUploadsRef.current.delete(attachment.id)
          if (isAbortError(error)) return
          const failure = uploadFailure(error)
          updateAttachments((current) =>
            current.map((candidate) =>
              candidate.id === attachment.id &&
              candidate.status === "uploading" &&
              candidate.attemptId === attemptId
                ? markAttachmentFailed(
                    candidate,
                    attemptId,
                    failure.message,
                    failure.retryable
                  )
                : candidate
            )
          )
          if (!failure.retryable) {
            toast({ title: failure.message, status: "error" })
          }
          setAnnouncement(
            `${attachment.file.name} upload failed. ${failure.message}`
          )
        })
    },
    [convex, updateAttachments]
  )

  const handleFileUpload = useCallback(
    (newFiles: File[]) => {
      if (newFiles.length === 0) return

      void (async () => {
        const existingSignatures = new Set(
          attachmentsRef.current.map((attachment) => attachment.signature)
        )
        const accepted: File[] = []
        let duplicateName: string | undefined
        for (const file of newFiles) {
          const signature = getFileSignature(file)
          if (
            existingSignatures.has(signature) ||
            accepted.some(
              (candidate) => getFileSignature(candidate) === signature
            )
          ) {
            duplicateName ??= file.name
            continue
          }
          accepted.push(file)
        }

        if (duplicateName) {
          setAnnouncement(`${duplicateName} is already attached.`)
        }
        if (accepted.length === 0) return

        try {
          const allowance = await checkFileUploadLimit(convex)
          const uploadingCount = attachmentsRef.current.filter(
            (attachment) => attachment.status === "uploading"
          ).length
          const remaining =
            allowance.limit === null
              ? Number.POSITIVE_INFINITY
              : Math.max(0, allowance.limit - allowance.count - uploadingCount)
          if (accepted.length > remaining) {
            const message =
              remaining === 0
                ? "Daily file upload limit reached."
                : `You can add ${remaining} more file${remaining === 1 ? "" : "s"} today.`
            toast({ title: message, status: "error" })
            setAnnouncement(message)
            return
          }
        } catch {
          // The mutation remains authoritative if this fast admission read is
          // temporarily unavailable.
        }

        const validation = await Promise.all(
          accepted.map(async (file) => {
            try {
              return { file, result: await validateFile(file) }
            } catch {
              return {
                file,
                result: {
                  isValid: false,
                  error: "Failed to read file for validation",
                },
              }
            }
          })
        )
        const valid = validation.filter(({ result }) => result.isValid)
        for (const { file, result } of validation) {
          if (result.isValid) continue
          const message = result.error ?? "File validation failed"
          toast({
            title: "File validation failed",
            description: message,
            status: "error",
          })
          setAnnouncement(`${file.name} was not attached. ${message}`)
        }
        if (valid.length === 0) return

        const next = valid.map(({ file }) => createSelectedFileAttachment(file))
        updateAttachments((current) => [...current, ...next])
        setAnnouncement(
          next.length === 1
            ? `${next[0]!.file.name} upload started.`
            : `${next.length} file uploads started.`
        )
        next.forEach((attachment) =>
          startUpload(attachment, attachment.attemptId)
        )
      })()
    },
    [convex, startUpload, updateAttachments]
  )

  const handleLargePaste = useCallback(
    (text: string) => {
      generatedPasteSequenceRef.current += 1
      const attachment = createGeneratedLargePasteAttachment(
        text,
        generatedPasteSequenceRef.current,
        uploadGeneratedPastes ? "upload" : "inline"
      )
      updateAttachments((current) => [...current, attachment])
      if (attachment.status === "uploading") {
        startUpload(attachment, attachment.attemptId)
      }
      return attachment
    },
    [startUpload, updateAttachments, uploadGeneratedPastes]
  )

  const handleFileRemove = useCallback(
    (attachment: PendingAttachment) => {
      if (lockedAttachmentIdsRef.current.has(attachment.id)) return false
      const active = activeUploadsRef.current.get(attachment.id)
      if (active) {
        activeUploadsRef.current.delete(attachment.id)
        active.controller.abort()
      }
      updateAttachments((current) =>
        current.filter((candidate) => candidate.id !== attachment.id)
      )
      if (attachment.status === "ready" && attachment.uploaded?.attachmentId) {
        void deleteUploadedAttachment(convex, attachment.uploaded.attachmentId)
      }
      setAnnouncement(
        active
          ? `${attachment.file.name} upload cancelled and removed.`
          : `${attachment.file.name} removed.`
      )
      return true
    },
    [convex, updateAttachments]
  )

  /** Lock one submitted snapshot before its async turn dispatch can yield. */
  const lockAttachments = useCallback((ids: readonly string[]) => {
    if (ids.some((id) => lockedAttachmentIdsRef.current.has(id))) return false
    if (ids.length === 0) return true
    const next = new Set(lockedAttachmentIdsRef.current)
    ids.forEach((id) => next.add(id))
    lockedAttachmentIdsRef.current = next
    setLockedAttachmentIds(next)
    return true
  }, [])

  const unlockAttachments = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return
    const next = new Set(lockedAttachmentIdsRef.current)
    ids.forEach((id) => next.delete(id))
    lockedAttachmentIdsRef.current = next
    setLockedAttachmentIds(next)
  }, [])

  const retryAttachment = useCallback(
    (attachment: PendingAttachment) => {
      if (attachment.status !== "failed" || !attachment.retryable) return
      const attemptId = attachment.attemptId + 1
      const retrying = markAttachmentUploading(attachment, attemptId)
      updateAttachments((current) =>
        current.map((candidate) =>
          candidate.id === attachment.id ? retrying : candidate
        )
      )
      setAnnouncement(`${attachment.file.name} retry started.`)
      startUpload(retrying, attemptId)
    },
    [startUpload, updateAttachments]
  )

  /** Remove successfully dispatched items without deleting their bound rows. */
  const consumeAttachments = useCallback(
    (ids: readonly string[]) => {
      const consumed = new Set(ids)
      updateAttachments((current) =>
        current.filter((attachment) => !consumed.has(attachment.id))
      )
    },
    [updateAttachments]
  )

  useBrowserLayoutEffect(() => {
    const activeUploads = activeUploadsRef.current
    return () => {
      for (const active of activeUploads.values()) active.controller.abort()
      activeUploads.clear()
    }
  }, [])

  return {
    attachments,
    lockedAttachmentIds,
    announcement,
    announce: setAnnouncement,
    handleFileUpload,
    handleLargePaste,
    handleFileRemove,
    lockAttachments,
    unlockAttachments,
    retryAttachment,
    consumeAttachments,
  }
}

/** @deprecated Turn-time uploading is retained only for older callers. */
export async function uploadFiles(
  _convex: ConvexReactClient,
  _files: File[],
  _chatId: string
): Promise<Attachment[] | null> {
  throw new Error("Files must be staged before Send")
}
