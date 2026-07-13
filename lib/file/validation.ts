import * as fileType from "file-type"
import {
  ALLOWED_FILE_TYPES,
  isAllowedFileMimeType,
  MAX_FILE_SIZE,
  normalizeFileMimeType,
} from "./policy"

export { ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from "./policy"

const TEXT_FILE_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
])

/**
 * MIME type -> file extensions mapping for the HTML file picker accept attribute.
 * Browsers need both MIME types and extensions for reliable filtering.
 */
export const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
  "application/json": [".json"],
  "text/csv": [".csv"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
}

/**
 * Comma-separated accept string for HTML `<input type="file" accept="...">`.
 * Derived from ALLOWED_FILE_TYPES so the file picker stays in sync with validation.
 */
export const ACCEPTED_FILE_PICKER_TYPES = ALLOWED_FILE_TYPES.flatMap((mime) => [
  mime,
  ...(MIME_TO_EXTENSIONS[mime] ?? []),
]).join(",")

export type FileValidationResult = {
  isValid: boolean
  error?: string
}

function isLikelyText(header: Uint8Array): boolean {
  return header.every(
    (byte) => byte === 0x09 || byte === 0x0a || byte === 0x0d || byte >= 0x20
  )
}

export async function validateFile(file: File): Promise<FileValidationResult> {
  if (file.size > MAX_FILE_SIZE) {
    return {
      isValid: false,
      error: `File size exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit`,
    }
  }

  const header = new Uint8Array(await file.slice(0, 4100).arrayBuffer())
  const type = await fileType.fileTypeFromBuffer(header)

  if (type && isAllowedFileMimeType(type.mime)) {
    return { isValid: true }
  }

  const declaredMimeType = normalizeFileMimeType(file.type)
  const canUseTextFallback =
    !type && TEXT_FILE_TYPES.has(declaredMimeType) && isLikelyText(header)

  if (!canUseTextFallback) {
    return {
      isValid: false,
      error: "File type not supported or doesn't match its extension",
    }
  }

  return { isValid: true }
}
