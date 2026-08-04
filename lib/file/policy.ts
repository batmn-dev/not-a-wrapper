export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export const ALLOWED_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const

export const ALLOWED_PROFILE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const

export function normalizeFileMimeType(mimeType: string | null | undefined) {
  return mimeType?.split(";")[0]?.trim().toLowerCase() ?? ""
}

export function isAllowedFileMimeType(mimeType: string | null | undefined) {
  return (ALLOWED_FILE_TYPES as readonly string[]).includes(
    normalizeFileMimeType(mimeType)
  )
}

export function isAllowedProfileImageMimeType(
  mimeType: string | null | undefined
) {
  return (ALLOWED_PROFILE_IMAGE_TYPES as readonly string[]).includes(
    normalizeFileMimeType(mimeType)
  )
}
