import { validateFile, type FileValidationResult } from "@/lib/file/validation"
import type { ConvexReactClient } from "convex/react"

export { ACCEPTED_FILE_PICKER_TYPES, validateFile } from "@/lib/file/validation"

export type Attachment = {
  name: string
  contentType: string
  url: string
}

export type ProcessFileValidationIssue = {
  file: File
  validation: FileValidationResult
}

export type ProcessFileUploadIssue = {
  file: File
  error: unknown
}

export type ProcessFilesOptions = {
  onValidationError?: (issue: ProcessFileValidationIssue) => void
  onUploadError?: (issue: ProcessFileUploadIssue) => void
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
export async function uploadFileToConvex(
  convex: ConvexReactClient,
  file: File,
  chatId: string
): Promise<string> {
  // Import dynamically to avoid circular imports
  const { api } = await import("@/convex/_generated/api")

  // 1. Generate upload URL
  const uploadUrl = await convex.mutation(api.files.generateUploadUrl, {})

  // 2. Upload file to Convex storage
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  })

  if (!response.ok) {
    throw new Error(`Failed to upload file: ${response.statusText}`)
  }

  const { storageId } = await response.json()

  // 3. Save attachment metadata
  await convex.mutation(api.files.saveAttachment, {
    chatId: chatId as unknown as typeof api.files.saveAttachment._args.chatId,
    storageId,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  })

  // 4. Get the public URL for the file
  const fileUrl = await convex.query(api.files.getUrl, { storageId })
  if (!fileUrl) {
    throw new Error("Failed to get file URL after upload")
  }

  return fileUrl
}

// ============================================================================
// Common Operations
// ============================================================================

export function createAttachment(file: File, url: string): Attachment {
  return {
    name: file.name,
    contentType: file.type,
    url,
  }
}

/**
 * Process files for upload using Convex
 * @param files Files to process
 * @param chatId Chat ID for attaching files
 * @param convex Convex client for uploads
 */
export async function processFiles(
  files: File[],
  chatId: string,
  convex: ConvexReactClient,
  options: ProcessFilesOptions = {}
): Promise<Attachment[]> {
  const attachments: Attachment[] = []

  for (const file of files) {
    let validation: FileValidationResult
    try {
      validation = await validateFile(file)
    } catch {
      options.onValidationError?.({
        file,
        validation: {
          isValid: false,
          error: "Failed to read file for validation",
        },
      })
      continue
    }

    if (!validation.isValid) {
      options.onValidationError?.({ file, validation })
      continue
    }

    try {
      const url = await uploadFileToConvex(convex, file, chatId)
      attachments.push(createAttachment(file, url))
    } catch (error) {
      options.onUploadError?.({ file, error })
    }
  }

  return attachments
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
): Promise<number> {
  const { api } = await import("@/convex/_generated/api")
  const result = await convex.query(api.files.checkUploadLimit, {})

  if (!result.canUpload) {
    throw new FileUploadLimitError("Daily file upload limit reached.")
  }

  return result.count
}
