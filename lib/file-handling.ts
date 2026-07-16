import type { ConvexReactClient } from "convex/react"

export { ACCEPTED_FILE_PICKER_TYPES, validateFile } from "@/lib/file/validation"

export type Attachment = {
  name: string
  contentType: string
  url: string
  attachmentId?: string
}

export type FileUploadProgress = {
  loaded: number
  total: number
  percent: number
}

export type UploadFileOptions = {
  signal?: AbortSignal
  onProgress?: (progress: FileUploadProgress) => void
  uploadBinary?: typeof uploadBinaryWithProgress
}

// ============================================================================
// Convex File Operations
// ============================================================================

/**
 * Upload a file to Convex storage
 * 1. Generate an upload URL
 * 2. Upload the file directly to Convex storage
 * 3. Save attachment metadata in the database
 */
export function uploadBinaryWithProgress(
  uploadUrl: string,
  file: File,
  options: Pick<UploadFileOptions, "signal" | "onProgress"> = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()

    xhr.open("POST", uploadUrl)
    xhr.setRequestHeader("Content-Type", file.type)
    xhr.responseType = "json"
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total <= 0) return
      options.onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent: Math.min(100, Math.round((event.loaded / event.total) * 100)),
      })
    })
    xhr.addEventListener("load", () => {
      options.signal?.removeEventListener("abort", abort)
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Failed to upload file (${xhr.status})`))
        return
      }
      const response = xhr.response as { storageId?: unknown } | null
      if (!response || typeof response.storageId !== "string") {
        reject(new Error("Upload response did not include a storage id"))
        return
      }
      resolve(response.storageId)
    })
    xhr.addEventListener("error", () => {
      options.signal?.removeEventListener("abort", abort)
      reject(new Error("File upload failed"))
    })
    xhr.addEventListener("abort", () => {
      options.signal?.removeEventListener("abort", abort)
      reject(new DOMException("Upload cancelled", "AbortError"))
    })

    if (options.signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"))
      return
    }
    options.signal?.addEventListener("abort", abort, { once: true })
    xhr.send(file)
  })
}

export async function uploadStagedFile(
  convex: ConvexReactClient,
  file: File,
  options: UploadFileOptions = {}
): Promise<{ fileUrl: string; attachmentId: string }> {
  // Import dynamically to avoid circular imports
  const { api } = await import("@/convex/_generated/api")

  // 1. Generate upload URL
  const uploadUrl = await convex.mutation(api.files.generateUploadUrl, {})
  if (!uploadUrl) {
    throw new FileUploadLimitError("Daily file upload limit reached.")
  }

  // 2. Upload file to Convex storage
  const storageId = await (options.uploadBinary ?? uploadBinaryWithProgress)(
    uploadUrl,
    file,
    options
  )

  // 3. Save user-owned staged metadata. A chat is intentionally not required.
  const attachmentId = await convex.mutation(api.files.saveStagedAttachment, {
    storageId:
      storageId as unknown as typeof api.files.saveStagedAttachment._args.storageId,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  })
  if (!attachmentId) {
    throw new FileUploadLimitError("Daily file upload limit reached.")
  }

  // Preview through a same-origin owner-checked route. The canonical storage
  // URL is returned only after the staged set is bound to a chat at Send.
  const fileUrl = `/api/files/${attachmentId}/preview`

  return { fileUrl, attachmentId }
}

export async function attachStagedFilesToChat(
  convex: ConvexReactClient,
  chatId: string,
  attachmentIds: string[]
): Promise<Attachment[]> {
  if (attachmentIds.length === 0) return []
  const { api } = await import("@/convex/_generated/api")
  return await convex.mutation(api.files.attachStagedFiles, {
    chatId:
      chatId as unknown as typeof api.files.attachStagedFiles._args.chatId,
    attachmentIds:
      attachmentIds as unknown as typeof api.files.attachStagedFiles._args.attachmentIds,
  })
}

export async function deleteUploadedAttachment(
  convex: ConvexReactClient,
  attachmentId: string
): Promise<void> {
  const { api } = await import("@/convex/_generated/api")
  await convex.mutation(api.files.deleteFile, {
    attachmentId:
      attachmentId as unknown as typeof api.files.deleteFile._args.attachmentId,
  })
}

export class FileUploadLimitError extends Error {
  code: string
  constructor(message: string) {
    super(message)
    this.code = "DAILY_FILE_LIMIT_REACHED"
  }
}

/**
 * Check file upload limit using Convex
 */
export async function checkFileUploadLimit(
  convex: ConvexReactClient
): Promise<{ count: number; limit: number | null; canUpload: boolean }> {
  const { api } = await import("@/convex/_generated/api")
  const result = await convex.query(api.files.checkUploadLimit, {})

  if (!result.canUpload) {
    throw new FileUploadLimitError("Daily file upload limit reached.")
  }

  return {
    count: result.count ?? 0,
    limit: result.limit,
    canUpload: result.canUpload,
  }
}
