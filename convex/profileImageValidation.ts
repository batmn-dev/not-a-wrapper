"use node"

import { v } from "convex/values"
import sharp from "sharp"
import {
  isAllowedProfileImageMimeType,
  normalizeFileMimeType,
} from "../lib/file/policy"
import { internalAction } from "./_generated/server"

const PROFILE_IMAGE_DECODE_TIMEOUT_SECONDS = 5
export const PROFILE_IMAGE_MAX_INPUT_PIXELS = 4096 * 4096

const PROFILE_IMAGE_MIME_BY_SHARP_FORMAT: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

/**
 * Require the complete image payload to decode as its declared profile-image
 * format. Signature sniffing remains a cheap prefilter at the HTTP boundary;
 * this is the authoritative content validation before the upload is committed.
 */
export async function isDecodableProfileImage(
  bytes: Uint8Array,
  declaredType: string
): Promise<boolean> {
  const normalizedType = normalizeFileMimeType(declaredType)
  if (!isAllowedProfileImageMimeType(normalizedType)) return false

  const inputOptions = {
    animated: true,
    failOn: "warning" as const,
    limitInputPixels: PROFILE_IMAGE_MAX_INPUT_PIXELS,
  }

  try {
    const metadata = await sharp(bytes, inputOptions)
      .timeout({ seconds: PROFILE_IMAGE_DECODE_TIMEOUT_SECONDS })
      .metadata()
    if (
      !metadata.format ||
      PROFILE_IMAGE_MIME_BY_SHARP_FORMAT[metadata.format] !== normalizedType
    ) {
      return false
    }

    // `metadata()` reads only headers. Pixel-derived stats force libvips to
    // decode the full input while avoiding a second encoded output buffer.
    await sharp(bytes, inputOptions)
      .timeout({ seconds: PROFILE_IMAGE_DECODE_TIMEOUT_SECONDS })
      .stats()
    return true
  } catch {
    return false
  }
}

export const validateStoredProfileImage = internalAction({
  args: {
    storageId: v.id("_storage"),
    fileType: v.string(),
  },
  returns: v.object({ valid: v.boolean() }),
  handler: async (ctx, { storageId, fileType }) => {
    const blob = await ctx.storage.get(storageId)
    if (!blob) throw new Error("Staged profile image is unavailable")

    const bytes = new Uint8Array(await blob.arrayBuffer())
    return { valid: await isDecodableProfileImage(bytes, fileType) }
  },
})
