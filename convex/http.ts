import { httpRouter } from "convex/server"
import { internal } from "./_generated/api"
import { httpAction, type ActionCtx } from "./_generated/server"
import {
  GRANT_REJECTION_MESSAGES,
  grantRejectionCode,
  type DurableWorkerPayloads,
  type GrantAuthArgs,
} from "./chatRuntimeWorker"
import { sha256Hex } from "./lib/sha256"
import { authKit } from "./workosAuth"

const http = httpRouter()

authKit.registerRoutes(http)

type DurableWorkerOp = keyof DurableWorkerPayloads

// The Durable worker wire (ADR-0011): run-scoped writes authorized by an
// execution grant instead of the user's request token. The raw Bearer secret
// is hashed HERE, before dispatch, so it never appears in a mutation argument
// or the function log; the grant-authorized internal mutations compare
// digests transactionally against the run row.
//
// One dispatch closure per op: `runMutation(ref, args)` type-checks each
// payload against its mutation's validators, so drift between the wire
// contract (`DurableWorkerPayloads`) and `chatRuntimeWorker` is a compile
// error in this table, not a runtime 400.
const WORKER_OPS: {
  [Op in DurableWorkerOp]: (
    ctx: ActionCtx,
    args: DurableWorkerPayloads[Op] & GrantAuthArgs
  ) => Promise<unknown>
} = {
  updateAssistantSnapshot: (ctx, args) =>
    ctx.runMutation(internal.chatRuntimeWorker.updateAssistantSnapshot, args),
  recordToolInvocations: (ctx, args) =>
    ctx.runMutation(internal.chatRuntimeWorker.recordToolInvocations, args),
  createToolApprovalRequest: (ctx, args) =>
    ctx.runMutation(internal.chatRuntimeWorker.createToolApprovalRequest, args),
  markGenerationRunCompleted: (ctx, args) =>
    ctx.runMutation(
      internal.chatRuntimeWorker.markGenerationRunCompleted,
      args
    ),
  markGenerationRunFailed: (ctx, args) =>
    ctx.runMutation(internal.chatRuntimeWorker.markGenerationRunFailed, args),
  markGenerationRunAborted: (ctx, args) =>
    ctx.runMutation(internal.chatRuntimeWorker.markGenerationRunAborted, args),
}

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

    // The payload arrives as untyped network JSON; each op's mutation
    // validators are its runtime contract. This is the wire boundary's single
    // coercion — the dispatch table above keeps payload/validator agreement
    // compile-checked.
    const dispatch = WORKER_OPS[op as DurableWorkerOp] as (
      ctx: ActionCtx,
      args: Record<string, unknown>
    ) => Promise<unknown>

    try {
      await dispatch(ctx, { ...(args as Record<string, unknown>), grantDigest })
      return jsonResponse(200, { ok: true })
    } catch (error) {
      const rejection = grantRejectionCode(error)
      if (rejection) {
        return jsonResponse(401, {
          ok: false,
          error: GRANT_REJECTION_MESSAGES[rejection],
        })
      }
      const message = error instanceof Error ? error.message : String(error)
      return jsonResponse(400, { ok: false, error: message })
    }
  }),
})

export default http
