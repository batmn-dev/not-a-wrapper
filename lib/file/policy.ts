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

/** Bytes needed to distinguish every ALLOWED_PROFILE_IMAGE_TYPES signature. */
export const PROFILE_IMAGE_SNIFF_BYTES = 12

function bytesAt(bytes: Uint8Array, offset: number, signature: number[]) {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

/**
 * Magic-byte sniff limited to the profile-image formats. Dependency-free so
 * the Convex isolate runtime can enforce it server-side (the richer
 * `file-type`-based check in validation.ts stays browser-only).
 */
export function sniffProfileImageMimeType(bytes: Uint8Array): string | null {
  if (bytesAt(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (bytesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png"
  }
  // "GIF87a" or "GIF89a"
  if (
    bytesAt(bytes, 0, [0x47, 0x49, 0x46, 0x38]) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif"
  }
  // "RIFF" <size> "WEBP"
  if (
    bytesAt(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    bytesAt(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp"
  }
  return null
}
