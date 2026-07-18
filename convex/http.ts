import { httpRouter } from "convex/server"
import { internal } from "./_generated/api"
import { httpAction } from "./_generated/server"
import { sha256Hex } from "./lib/sha256"
import { authKit } from "./workosAuth"

const http = httpRouter()

authKit.registerRoutes(http)

// The Durable worker wire (ADR-0011): run-scoped writes authorized by an
// execution grant instead of the user's request token. The raw Bearer secret
// is hashed HERE, before dispatch, so it never appears in a mutation argument
// or the function log; the grant-authorized internal mutations compare
// digests transactionally against the run row.
const WORKER_OPS = {
  updateAssistantSnapshot: internal.chatRuntimeWorker.updateAssistantSnapshot,
  recordToolInvocations: internal.chatRuntimeWorker.recordToolInvocations,
  createToolApprovalRequest:
    internal.chatRuntimeWorker.createToolApprovalRequest,
  markGenerationRunCompleted:
    internal.chatRuntimeWorker.markGenerationRunCompleted,
  markGenerationRunFailed: internal.chatRuntimeWorker.markGenerationRunFailed,
  markGenerationRunAborted: internal.chatRuntimeWorker.markGenerationRunAborted,
} as const

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

http.route({
  path: "/chat-turn/worker",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authorization = request.headers.get("Authorization")
    if (!authorization?.startsWith("Bearer ")) {
      return jsonResponse(401, { ok: false, error: "Missing bearer secret" })
    }
    const grantDigest = sha256Hex(authorization.slice("Bearer ".length))

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse(400, { ok: false, error: "Invalid JSON body" })
    }
    const { op, args } = (body ?? {}) as { op?: unknown; args?: unknown }
    if (
      typeof op !== "string" ||
      !(op in WORKER_OPS) ||
      !args ||
      typeof args !== "object"
    ) {
      return jsonResponse(400, { ok: false, error: "Invalid worker call" })
    }

    try {
      await ctx.runMutation(WORKER_OPS[op as keyof typeof WORKER_OPS], {
        ...(args as Record<string, unknown>),
        grantDigest,
      } as never)
      return jsonResponse(200, { ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = message.includes("Execution grant") ? 401 : 400
      return jsonResponse(status, { ok: false, error: message })
    }
  }),
})

export default http
