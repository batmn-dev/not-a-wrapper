import { toast } from "@/components/ui/toast"
import {
  Attachment,
  checkFileUploadLimit,
  processFiles,
} from "@/lib/file-handling"
import { useConvex } from "convex/react"
import { useCallback, useState } from "react"

export const useFileUpload = () => {
  const [files, setFiles] = useState<File[]>([])
  const convex = useConvex()

  const handleFileUploads = async (
    chatId: string
  ): Promise<Attachment[] | null> => {
    if (files.length === 0) return []

    try {
      await checkFileUploadLimit(convex)
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string }
      if (error.code === "DAILY_FILE_LIMIT_REACHED") {
        toast({ title: error.message || "Daily file limit reached", status: "error" })
        return null
      }
    }

    try {
      const processed = await processFiles(files, chatId, convex, {
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
      setFiles([])
      return processed
    } catch {
      toast({ title: "Failed to process files", status: "error" })
      return null
    }
  }

  const createOptimisticAttachments = (files: File[]) => {
    return files.map((file) => ({
      name: file.name,
      contentType: file.type,
      url: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
    }))
  }

  const cleanupOptimisticAttachments = (attachments?: Array<{ url?: string }>) => {
    if (!attachments) return
    attachments.forEach((attachment) => {
      if (attachment.url?.startsWith("blob:")) {
        URL.revokeObjectURL(attachment.url)
      }
    })
  }

  const handleFileUpload = useCallback((newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles])
  }, [])

  const handleFileRemove = useCallback((file: File) => {
    setFiles((prev) => prev.filter((f) => f !== file))
  }, [])

  return {
    files,
    setFiles,
    handleFileUploads,
    createOptimisticAttachments,
    cleanupOptimisticAttachments,
    handleFileUpload,
    handleFileRemove,
  }
}
