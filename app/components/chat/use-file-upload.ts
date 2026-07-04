import { toast } from "@/components/ui/toast"
import {
  Attachment,
  checkFileUploadLimit,
  processFiles,
} from "@/lib/file-handling"
import { useCallback, useRef, useState } from "react"

type ConvexClient = Parameters<typeof processFiles>[2]
type FileRestoreToken = number

/**
 * Upload files for a chat at turn time. Pure of React state — the Composer
 * owns the pending File[] and hands them to the turn as part of its payload;
 * the turn runner calls this with those files when the chat id is known.
 */
export async function uploadFiles(
  convex: ConvexClient,
  files: File[],
  chatId: string
): Promise<Attachment[] | null> {
  if (files.length === 0) return []

  try {
    await checkFileUploadLimit(convex)
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string }
    if (error.code === "DAILY_FILE_LIMIT_REACHED") {
      toast({
        title: error.message || "Daily file limit reached",
        status: "error",
      })
      return null
    }
    console.warn(
      "File upload limit check failed; continuing with server-side enforcement:",
      error
    )
  }

  try {
    return await processFiles(files, chatId, convex, {
      onValidationError: ({ file, validation }) => {
        console.warn(`File ${file.name} validation failed:`, validation.error)
        toast({
          title: "File validation failed",
          description: validation.error,
          status: "error",
        })
      },
      onUploadError: ({ file, error }) => {
        console.error(`Error processing file ${file.name}:`, error)
        toast({
          title: "File upload failed",
          description: `Failed to upload ${file.name}`,
          status: "error",
        })
      },
    })
  } catch {
    toast({ title: "Failed to process files", status: "error" })
    return null
  }
}

export function createOptimisticAttachments(files: File[]) {
  return files.map((file) => ({
    name: file.name,
    contentType: file.type,
    url: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
  }))
}

export function cleanupOptimisticAttachments(
  attachments?: Array<{ url?: string }>
) {
  if (!attachments) return
  attachments.forEach((attachment) => {
    if (attachment.url?.startsWith("blob:")) {
      URL.revokeObjectURL(attachment.url)
    }
  })
}

/**
 * Pending-attachment state for the Composer. State only — uploading happens
 * at turn time via {@link uploadFiles} with the files the turn payload
 * carried.
 */
export const useFileUpload = () => {
  const [files, setFiles] = useState<File[]>([])
  const fileMutationVersionRef = useRef(0)

  const markFilesChanged = useCallback(() => {
    fileMutationVersionRef.current += 1
    return fileMutationVersionRef.current
  }, [])

  const handleFileUpload = useCallback(
    (newFiles: File[]) => {
      if (newFiles.length === 0) return
      markFilesChanged()
      setFiles((prev) => [...prev, ...newFiles])
    },
    [markFilesChanged]
  )

  const handleFileRemove = useCallback(
    (file: File) => {
      markFilesChanged()
      setFiles((prev) => prev.filter((f) => f !== file))
    },
    [markFilesChanged]
  )

  const clearFiles = useCallback(() => {
    const restoreToken = markFilesChanged()
    setFiles([])
    return restoreToken
  }, [markFilesChanged])

  /** Put a rejected turn's files back unless attachment state changed since clear. */
  const restoreFiles = useCallback(
    (previous: File[], token: FileRestoreToken) => {
      if (previous.length === 0) return
      if (fileMutationVersionRef.current !== token) return
      setFiles((prev) => (prev.length > 0 ? prev : previous))
    },
    []
  )

  return {
    files,
    handleFileUpload,
    handleFileRemove,
    clearFiles,
    restoreFiles,
  }
}
