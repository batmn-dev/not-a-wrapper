import { fetchClient } from "@/lib/fetch"

export async function uploadProfileImage(file: File): Promise<string> {
  const response = await fetchClient("/api/profile-image", {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  })
  if (!response.ok) {
    throw new Error("Profile image upload failed")
  }

  const body: unknown = await response.json()
  const profileImageUrl = (body as { profileImageUrl?: unknown } | null)
    ?.profileImageUrl
  if (typeof profileImageUrl !== "string" || !profileImageUrl) {
    throw new Error("Profile image upload response was invalid")
  }

  return profileImageUrl
}
