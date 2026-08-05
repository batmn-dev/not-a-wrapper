import { fetchClient } from "@/lib/fetch"
import { MAX_FILE_SIZE } from "@/lib/file/policy"

/** Upload failure whose message is safe to show directly in the settings UI. */
export class ProfileImageUploadError extends Error {}

const UPLOAD_ERROR_MESSAGES: Record<number, string> = {
  413: `Choose an image under ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
  415: "Choose a JPEG, PNG, GIF, or WebP image.",
  429: "You're updating your picture too quickly. Try again in a minute.",
}

export async function uploadProfileImage(file: File): Promise<string> {
  const response = await fetchClient("/api/profile-image", {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  })
  if (!response.ok) {
    throw new ProfileImageUploadError(
      UPLOAD_ERROR_MESSAGES[response.status] ?? "Profile image upload failed"
    )
  }

  const body: unknown = await response.json()
  const profileImageUrl = (body as { profileImageUrl?: unknown } | null)
    ?.profileImageUrl
  if (typeof profileImageUrl !== "string" || !profileImageUrl) {
    throw new Error("Profile image upload response was invalid")
  }

  return profileImageUrl
}
