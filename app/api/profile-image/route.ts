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

type CappedBodyRead =
  | { kind: "ok"; blob: Blob }
  | { kind: "too_large" }
  | { kind: "invalid" }

// Read the body incrementally so an oversized (or length-less chunked) upload
// is aborted at the cap instead of being buffered whole — `request.blob()`
// would hold the entire payload in memory before any size check could run.
async function readBodyCapped(
  request: Request,
  maxBytes: number,
  contentType: string
): Promise<CappedBodyRead> {
  const stream = request.body
  if (!stream) return { kind: "invalid" }

  const chunks: Uint8Array<ArrayBuffer>[] = []
  let totalBytes = 0
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {})
        return { kind: "too_large" }
      }
      chunks.push(value)
    }
  } catch {
    return { kind: "invalid" }
  }
  if (totalBytes === 0) return { kind: "invalid" }

  return { kind: "ok", blob: new Blob(chunks, { type: contentType }) }
}

export const POST = authenticatedRoute(async (request, { session }) => {
  const fileType = normalizeFileMimeType(request.headers.get("Content-Type"))
  if (!isAllowedProfileImageMimeType(fileType)) {
    return jsonError("Unsupported profile image type", 415)
  }

  // Fast pre-reject on the declared length; the capped read below is the
  // enforcement for clients that omit or understate it.
  const contentLength = Number(request.headers.get("Content-Length"))
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE) {
    return jsonError("Profile image is too large", 413)
  }

  const bodyRead = await readBodyCapped(request, MAX_FILE_SIZE, fileType)
  if (bodyRead.kind === "too_large") {
    return jsonError("Profile image is too large", 413)
  }
  if (bodyRead.kind === "invalid") {
    return jsonError("Invalid profile image body", 400)
  }

  try {
    const response = await fetch(`${getConvexSiteUrl()}/profile-image`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": fileType,
      },
      body: bodyRead.blob,
    })
    const body = await response.text()

    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type":
        response.headers.get("Content-Type") ?? "application/json",
    })
    const retryAfter = response.headers.get("Retry-After")
    if (retryAfter) headers.set("Retry-After", retryAfter)

    return new Response(body, { status: response.status, headers })
  } catch (error) {
    console.error("Profile image upload proxy failed", error)
    return internalServerError()
  }
})
