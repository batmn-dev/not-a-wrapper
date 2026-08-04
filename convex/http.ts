import { httpRouter } from "convex/server"
import { MAX_FILE_SIZE, normalizeFileMimeType } from "../lib/file/policy"
import { api, internal } from "./_generated/api"
import { httpAction, type ActionCtx } from "./_generated/server"
import {
  GRANT_REJECTION_MESSAGES,
  grantRejectionCode,
  type DurableWorkerPayloads,
  type GrantAuthArgs,
} from "./chatRuntimeWorker"
import { requireIdentity } from "./lib/auth"
import { sha256Hex } from "./lib/sha256"
import { isProfileImageMetadataValid } from "./users"
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
  markGenerationWorkStarted: (ctx, args) =>
    ctx.runMutation(
      internal.chatRuntimeWorker.markGenerationWorkStarted,
      args
    ),
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
  heartbeatGenerationRun: (ctx, args) =>
    ctx.runMutation(internal.chatRuntimeWorker.heartbeatGenerationRun, args),
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers?: HeadersInit
) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set("Content-Type", "application/json")
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  })
}

type ProfileImageUploadCtx = Pick<ActionCtx, "auth" | "runMutation" | "storage">

export async function handleProfileImageUploadRequest(
  ctx: ProfileImageUploadCtx,
  request: Request
): Promise<Response> {
  let identity: Awaited<ReturnType<typeof requireIdentity>>
  try {
    identity = await requireIdentity(ctx)
  } catch {
    return jsonResponse(401, { error: "Unauthorized" })
  }

  const fileType = normalizeFileMimeType(request.headers.get("Content-Type"))
  if (
    !isProfileImageMetadataValid({ size: 0, contentType: fileType }, fileType)
  ) {
    return jsonResponse(415, { error: "Unsupported profile image type" })
  }

  const contentLength = Number(request.headers.get("Content-Length"))
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE) {
    return jsonResponse(413, { error: "Profile image is too large" })
  }

  let rateLimit: {
    allowed: boolean
    retryAfterMs: number
  }
  try {
    rateLimit = await ctx.runMutation(api.rateLimits.consume, {
      bucket: "profile_image_upload",
    })
  } catch {
    console.warn(JSON.stringify({ _tag: "profile_image_rate_limit_failed" }))
    return jsonResponse(500, { error: "Profile image upload failed" })
  }
  if (!rateLimit.allowed) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(rateLimit.retryAfterMs / 1000)
    )
    return jsonResponse(
      429,
      { error: "Profile image upload rate limit exceeded" },
      { "Retry-After": String(retryAfterSeconds) }
    )
  }

  let blob: Blob
  try {
    blob = await request.blob()
  } catch {
    return jsonResponse(400, { error: "Invalid profile image body" })
  }
  if (blob.size > MAX_FILE_SIZE) {
    return jsonResponse(413, { error: "Profile image is too large" })
  }
  if (
    !isProfileImageMetadataValid(
      { size: blob.size, contentType: blob.type },
      fileType
    )
  ) {
    return jsonResponse(415, { error: "Unsupported profile image type" })
  }

  let storageId:
    Awaited<ReturnType<ProfileImageUploadCtx["storage"]["store"]>> | undefined
  try {
    storageId = await ctx.storage.store(blob)
    const profileImageUrl: string = await ctx.runMutation(
      internal.users.commitUploadedProfileImage,
      {
        workosUserId: identity.subject,
        storageId,
        fileType,
      }
    )
    return jsonResponse(200, { profileImageUrl })
  } catch {
    if (storageId !== undefined) {
      try {
        await ctx.storage.delete(storageId)
      } catch {
        console.warn(
          JSON.stringify({ _tag: "profile_image_upload_cleanup_failed" })
        )
      }
    }
    console.warn(JSON.stringify({ _tag: "profile_image_upload_failed" }))
    return jsonResponse(500, { error: "Profile image upload failed" })
  }
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
      // The mutation's return value rides back to the worker — the heartbeat's
      // renewed/paused/lost discriminant and the snapshot guard results are
      // branching inputs on the Next side, not fire-and-forget acks.
      const result = await dispatch(ctx, {
        ...(args as Record<string, unknown>),
        grantDigest,
      })
      return jsonResponse(200, { ok: true, result: result ?? null })
    } catch (error) {
      const rejection = grantRejectionCode(error)
      if (rejection) {
        return jsonResponse(401, {
          ok: false,
          code: rejection,
          error: GRANT_REJECTION_MESSAGES[rejection],
        })
      }
      // Generic body only: raw internal error text must not escape to the
      // caller — Convex argument-validation errors run BEFORE the grant check,
      // so this branch is reachable by an unauthenticated probe. The detail
      // stays in the deployment's function logs.
      console.warn(
        JSON.stringify({
          _tag: "chat_turn_worker_dispatch_failed",
          op,
          error: error instanceof Error ? error.message : String(error),
        })
      )
      return jsonResponse(400, { ok: false, error: "Invalid worker call" })
    }
  }),
})

http.route({
  path: "/profile-image",
  method: "POST",
  handler: httpAction(handleProfileImageUploadRequest),
})

export default http
