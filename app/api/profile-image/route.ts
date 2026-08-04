import { authenticatedRoute } from "@/app/api/_lib/authenticated-route"
import {
  getConvexSiteUrl,
  internalServerError,
  jsonError,
} from "@/app/api/_lib/convex"
import {
  isAllowedProfileImageMimeType,
  MAX_FILE_SIZE,
  normalizeFileMimeType,
} from "@/lib/file/policy"

export const POST = authenticatedRoute(async (request, { session }) => {
  const fileType = normalizeFileMimeType(request.headers.get("Content-Type"))
  if (!isAllowedProfileImageMimeType(fileType)) {
    return jsonError("Unsupported profile image type", 415)
  }

  const contentLength = Number(request.headers.get("Content-Length"))
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE) {
    return jsonError("Profile image is too large", 413)
  }

  let blob: Blob
  try {
    blob = await request.blob()
  } catch {
    return jsonError("Invalid profile image body", 400)
  }
  if (blob.size > MAX_FILE_SIZE) {
    return jsonError("Profile image is too large", 413)
  }

  try {
    const response = await fetch(`${getConvexSiteUrl()}/profile-image`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": fileType,
      },
      body: blob,
    })
    const body = await response.text()

    return new Response(body, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    })
  } catch {
    console.error("Profile image upload proxy failed")
    return internalServerError()
  }
})
