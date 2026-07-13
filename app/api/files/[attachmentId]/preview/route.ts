import { authenticatedRoute } from "@/app/api/_lib/authenticated-route"
import { internalServerError, jsonError } from "@/app/api/_lib/convex"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

type PreviewRouteArgs = { params: Promise<{ attachmentId: string }> }

function inlineDisposition(fileName: string): string {
  return `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export const GET = authenticatedRoute(
  async (request, { convex }, { params }: PreviewRouteArgs) => {
    try {
      const { attachmentId } = await params
      if (!attachmentId) return jsonError("Attachment not found", 404)

      const preview = await convex.query(api.files.getAttachmentPreview, {
        attachmentId: attachmentId as Id<"chatAttachments">,
      })
      if (!preview) return jsonError("Attachment not found", 404)

      const range = request.headers.get("range")
      const upstream = await fetch(preview.url, {
        headers: range ? { Range: range } : undefined,
      })
      if (!upstream.ok || !upstream.body) return internalServerError()

      const headers = new Headers({
        "Content-Type": preview.fileType,
        "Content-Disposition": inlineDisposition(preview.fileName),
        "Cache-Control": "private, no-store",
        // The application shell is globally non-embeddable. This owner-checked
        // file response is the narrow exception: it may render only inside the
        // same origin's preview dialog.
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
        "X-Frame-Options": "SAMEORIGIN",
        "X-Content-Type-Options": "nosniff",
      })
      for (const name of ["accept-ranges", "content-length", "content-range"]) {
        const value = upstream.headers.get(name)
        if (value) headers.set(name, value)
      }

      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      })
    } catch (error) {
      console.error("Attachment preview failed:", error)
      return internalServerError()
    }
  }
)
