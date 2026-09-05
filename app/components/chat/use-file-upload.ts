import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import { toast } from "@/components/ui/toast"
import {
  checkFileUploadLimit,
  deleteUploadedAttachment,
  FileUploadLimitError,
  uploadStagedFile,
} from "@/lib/file-handling"
import { validateFile } from "@/lib/file/validation"
import type { ConvexReactClient } from "convex/react"
import { useCallback, useRef, useState } from "react"
import {
  assembleComposerTurnPayload,
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
  const pendingAdmissionsRef = useRef(new Set<string>())
  const admissionTailRef = useRef<Promise<void> | null>(null)
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

      const existingSignatures = new Set(
        attachmentsRef.current.map((attachment) => attachment.signature)
      )
      const accepted = newFiles.filter((file) => {
        const signature = getFileSignature(file)
        if (existingSignatures.has(signature)) {
          setAnnouncement(`${file.name} is already attached.`)
          return false
        }
        existingSignatures.add(signature)
        return true
      })
      if (accepted.length === 0) return

      // Reserve identity and display before admission yields. Selection order
      // decides which pending batch gets the remaining daily capacity.
      const earlierIds = new Set(attachmentsRef.current.map(({ id }) => id))
      const pending = accepted.map((file) => createSelectedFileAttachment(file))
      pending.forEach(({ id }) => pendingAdmissionsRef.current.add(id))
      updateAttachments((current) => [...current, ...pending])

      const rejectPending = (message: string) => {
        const rejectedIds = new Set(
          pending
            .filter(({ id }) => pendingAdmissionsRef.current.has(id))
            .map(({ id }) => id)
        )
        if (rejectedIds.size === 0) return
        updateAttachments((current) =>
          current.filter(({ id }) => !rejectedIds.has(id))
        )
        toast({ title: message, status: "error" })
        setAnnouncement(message)
      }

      const previousAdmission = admissionTailRef.current
      admissionTailRef.current = (async () => {
        try {
          // Release earlier invalid reservations before checking this batch.
          // Transfers still run concurrently once admission completes.
          if (previousAdmission) await previousAdmission
          if (!pending.some(({ id }) => pendingAdmissionsRef.current.has(id)))
            return
          try {
            const allowance = await checkFileUploadLimit(convex)
            const uploadingCount = attachmentsRef.current.filter(
              (attachment) =>
                earlierIds.has(attachment.id) &&
                attachment.status === "uploading"
            ).length
            const remaining =
              allowance.limit === null
                ? Number.POSITIVE_INFINITY
                : Math.max(
                    0,
                    allowance.limit - allowance.count - uploadingCount
                  )
            const selected = pending.filter(({ id }) =>
              pendingAdmissionsRef.current.has(id)
            )
            if (selected.length > remaining) {
              const message =
                remaining === 0
                  ? "Daily file upload limit reached."
                  : `You can add ${remaining} more file${remaining === 1 ? "" : "s"} today.`
              rejectPending(message)
              return
            }
          } catch (error) {
            if (error instanceof FileUploadLimitError) {
              rejectPending("Daily file upload limit reached.")
              return
            }
            // The mutation remains authoritative if the admission read fails.
          }

          const validation = await Promise.all(
            pending
              .filter(({ id }) => pendingAdmissionsRef.current.has(id))
              .map(async (attachment) => {
                try {
                  return {
                    attachment,
                    result: await validateFile(attachment.file),
                  }
                } catch {
                  return {
                    attachment,
                    result: {
                      isValid: false,
                      error: "Failed to read file for validation",
                    },
                  }
                }
              })
          )
          for (const { attachment, result } of validation) {
            // Removal and unmount invalidate admission as well as uploads.
            if (!pendingAdmissionsRef.current.has(attachment.id)) continue
            if (!result.isValid) {
              updateAttachments((current) =>
                current.filter(({ id }) => id !== attachment.id)
              )
              const message = result.error ?? "File validation failed"
              toast({
                title: "File validation failed",
                description: message,
                status: "error",
              })
              setAnnouncement(
                `${attachment.file.name} was not attached. ${message}`
              )
              continue
            }
            startUpload(attachment, attachment.attemptId)
            setAnnouncement(`${attachment.file.name} upload started.`)
          }
        } finally {
          pending.forEach(({ id }) => pendingAdmissionsRef.current.delete(id))
        }
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
    (selected: PendingAttachment) => {
      const attachment = attachmentsRef.current.find(
        ({ id }) => id === selected.id
      )
      if (!attachment || lockedAttachmentIdsRef.current.has(attachment.id))
        return false
      pendingAdmissionsRef.current.delete(attachment.id)
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

  const retryAttachment = useCallback(
    (selected: PendingAttachment) => {
      const attachment = attachmentsRef.current.find(
        ({ id }) => id === selected.id
      )
      if (
        !attachment ||
        attachment.status !== "failed" ||
        !attachment.retryable
      )
        return
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

  /** Own the submitted snapshot until dispatch accepts or rejects it. */
  const submitAttachments = useCallback(
    async (
      text: string,
      dispatch: (
        payload: ReturnType<typeof assembleComposerTurnPayload>
      ) => boolean | Promise<boolean>
    ): Promise<boolean> => {
      const submitted = attachmentsRef.current
      if (submitted.some(({ status }) => status !== "ready")) {
        setAnnouncement(
          "Wait for every attachment to finish uploading, or remove failed files."
        )
        return false
      }
      if (submitted.some(({ id }) => lockedAttachmentIdsRef.current.has(id)))
        return false
      const ids = new Set(submitted.map(({ id }) => id))
      const locked = new Set([...lockedAttachmentIdsRef.current, ...ids])
      lockedAttachmentIdsRef.current = locked
      setLockedAttachmentIds(locked)
      let accepted = false
      try {
        accepted = await dispatch(
          assembleComposerTurnPayload({ text, attachments: submitted })
        )
        if (accepted) {
          // Bound uploads belong to the chat; consuming never deletes them.
          updateAttachments((current) =>
            current.filter(({ id }) => !ids.has(id))
          )
        }
        return accepted
      } finally {
        const remaining = new Set(lockedAttachmentIdsRef.current)
        ids.forEach((id) => remaining.delete(id))
        lockedAttachmentIdsRef.current = remaining
        setLockedAttachmentIds(remaining)
        if (submitted.length > 0) {
          setAnnouncement(
            accepted
              ? `${submitted.length} attachment${submitted.length === 1 ? "" : "s"} sent.`
              : "Send failed. Ready attachments were preserved."
          )
        }
      }
    },
    [updateAttachments]
  )

  useBrowserLayoutEffect(() => {
    const pendingAdmissions = pendingAdmissionsRef.current
    const activeUploads = activeUploadsRef.current
    return () => {
      pendingAdmissions.clear()
      for (const active of activeUploads.values()) active.controller.abort()
      activeUploads.clear()
    }
  }, [])

  return {
    attachments,
    attachmentsReady: attachments.every(({ status }) => status === "ready"),
    lockedAttachmentIds,
    announcement,
    announce: setAnnouncement,
    handleFileUpload,
    handleLargePaste,
    handleFileRemove,
    submitAttachments,
    retryAttachment,
  }
}
