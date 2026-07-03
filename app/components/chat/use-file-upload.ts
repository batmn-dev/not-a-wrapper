import { toast } from "@/components/ui/toast"
import {
  Attachment,
  checkFileUploadLimit,
  processFiles,
} from "@/lib/file-handling"
import { useCallback, useState } from "react"

type ConvexClient = Parameters<typeof processFiles>[2]

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

  const handleFileUpload = useCallback((newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles])
  }, [])

  const handleFileRemove = useCallback((file: File) => {
    setFiles((prev) => prev.filter((f) => f !== file))
  }, [])

  const clearFiles = useCallback(() => {
    setFiles([])
  }, [])

  /** Put a rejected turn's files back — unless the user attached new ones
   * while the turn was in flight. */
  const restoreFiles = useCallback((previous: File[]) => {
    if (previous.length === 0) return
    setFiles((prev) => (prev.length > 0 ? prev : previous))
  }, [])

  return {
    files,
    handleFileUpload,
    handleFileRemove,
    clearFiles,
    restoreFiles,
  }
}
