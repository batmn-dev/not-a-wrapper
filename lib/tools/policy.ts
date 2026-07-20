import { api } from "@/convex/_generated/api"
import {
  EXTRACT_CONTENT_DOMAIN_MAX_REQUESTS,
  EXTRACT_CONTENT_DOMAIN_WINDOW_MS,
  TOOL_BUDGET_LIMITS,
  TOOL_BUDGET_WINDOW_MS,
  TOOL_LIMIT_BUCKET_SIZE_MS,
} from "@/lib/config"
import { fetchMutation } from "convex/nextjs"

export type ToolKeyMode = "platform" | "byok"
export type ToolLimitType = "domain" | "budget"

export type ToolDomainLimitCode = `${string}_DOMAIN_LIMIT_EXCEEDED`
export type ToolPolicyCode =
  ToolDomainLimitCode | "TOOL_BUDGET_EXCEEDED" | "TOOL_POLICY_UNAVAILABLE"

export type ToolPolicyErrorData = {
  code: ToolPolicyCode
  retryAfterSeconds?: number
  keyMode?: ToolKeyMode
  scopeKey?: string
  budgetDenied?: boolean
}

export class ToolPolicyError extends Error {
  readonly code: ToolPolicyCode
  readonly retryAfterSeconds?: number
  readonly keyMode?: ToolKeyMode
  readonly scopeKey?: string
  readonly budgetDenied?: boolean

  constructor(message: string, data: ToolPolicyErrorData) {
    super(message)
    this.name = "ToolPolicyError"
    this.code = data.code
    this.retryAfterSeconds = data.retryAfterSeconds
    this.keyMode = data.keyMode
    this.scopeKey = data.scopeKey
    this.budgetDenied = data.budgetDenied
  }
}

export function isToolPolicyError(err: unknown): err is ToolPolicyError {
  return err instanceof ToolPolicyError
}

export function isPolicyUnavailableError(err: unknown): err is ToolPolicyError {
  return isToolPolicyError(err) && err.code === "TOOL_POLICY_UNAVAILABLE"
}

export function extractPolicyErrorData(
  err: unknown
): ToolPolicyErrorData | null {
  if (!isToolPolicyError(err)) return null
  return {
    code: err.code,
    retryAfterSeconds: err.retryAfterSeconds,
    keyMode: err.keyMode,
    scopeKey: err.scopeKey,
    budgetDenied: err.budgetDenied,
  }
}

export type RequestLocalToolSoftCapSnapshot = {
  toolName: string
  used: number
  remaining: number
  maxCalls: number
}

export type RequestLocalToolSoftCap = {
  getSnapshot(toolName: string): RequestLocalToolSoftCapSnapshot
  recordCall(toolName: string): RequestLocalToolSoftCapSnapshot
}

export function createRequestLocalToolSoftCap(options?: {
  maxCallsPerTool?: number
}): RequestLocalToolSoftCap {
  const maxCallsPerTool = Math.max(1, Math.trunc(options?.maxCallsPerTool ?? 3))
  const callsByTool = new Map<string, number>()

  const snapshotFor = (toolName: string): RequestLocalToolSoftCapSnapshot => {
    const used = callsByTool.get(toolName) ?? 0
    return {
      toolName,
      used,
      remaining: Math.max(0, maxCallsPerTool - used),
      maxCalls: maxCallsPerTool,
    }
  }

  return {
    getSnapshot(toolName: string): RequestLocalToolSoftCapSnapshot {
      return snapshotFor(toolName)
    },
    recordCall(toolName: string): RequestLocalToolSoftCapSnapshot {
      const used = (callsByTool.get(toolName) ?? 0) + 1
      callsByTool.set(toolName, used)
      return snapshotFor(toolName)
    },
  }
}

export type OutageTolerantBudgetEvent =
  | {
      type: "recovered"
      toolName: string
      keyMode: ToolKeyMode
    }
  | {
      type: "degraded_allow"
      toolName: string
      keyMode: ToolKeyMode
      retryAfterSeconds?: number
      snapshot: RequestLocalToolSoftCapSnapshot
      error: string
    }
  | {
      type: "degraded_block"
      toolName: string
      keyMode: ToolKeyMode
      retryAfterSeconds?: number
      snapshot: RequestLocalToolSoftCapSnapshot
      error: string
    }

export function createOutageTolerantToolBudgetEnforcer(options: {
  enforceToolBudget: (toolName: string) => Promise<void>
  keyMode: ToolKeyMode
  maxCallsPerTool?: number
  onEvent?: (event: OutageTolerantBudgetEvent) => void
}): (toolName: string) => Promise<void> {
  const softCap = createRequestLocalToolSoftCap({
    maxCallsPerTool: options.maxCallsPerTool,
  })
  const degradedTools = new Set<string>()
  const exhaustedTools = new Set<string>()

  return async (toolName: string) => {
    if (exhaustedTools.has(toolName)) {
      throw new ToolPolicyError(
        "TOOL_BUDGET_EXCEEDED: Tool budget exceeded while policy service is unavailable. Retry later with fewer tool calls.",
        {
          code: "TOOL_BUDGET_EXCEEDED",
          keyMode: options.keyMode,
          scopeKey: "*",
          budgetDenied: true,
        }
      )
    }

    try {
      await options.enforceToolBudget(toolName)
      if (degradedTools.delete(toolName)) {
        options.onEvent?.({
          type: "recovered",
          toolName,
          keyMode: options.keyMode,
        })
      }
      return
    } catch (error) {
      if (!isPolicyUnavailableError(error)) {
        throw error
      }

      degradedTools.add(toolName)
      const current = softCap.getSnapshot(toolName)
      if (current.remaining <= 0) {
        exhaustedTools.add(toolName)
        options.onEvent?.({
          type: "degraded_block",
          toolName,
          keyMode: options.keyMode,
          retryAfterSeconds: error.retryAfterSeconds,
          snapshot: current,
          error: error.message,
        })
        throw new ToolPolicyError(
          "TOOL_BUDGET_EXCEEDED: Tool budget exceeded while policy service is unavailable. Retry later with fewer tool calls.",
          {
            code: "TOOL_BUDGET_EXCEEDED",
            retryAfterSeconds: error.retryAfterSeconds,
            keyMode: options.keyMode,
            scopeKey: "*",
            budgetDenied: true,
          }
        )
      }

      const snapshot = softCap.recordCall(toolName)
      options.onEvent?.({
        type: "degraded_allow",
        toolName,
        keyMode: options.keyMode,
        retryAfterSeconds: error.retryAfterSeconds,
        snapshot,
        error: error.message,
      })
    }
  }
}

type ScopeCount = {
  scopeKey: string
  count: number
}

type ToolLimitStoreInput = {
  actorKey?: string
  limitType: ToolLimitType
  toolName: string
  keyMode: ToolKeyMode
  scopeCounts: ScopeCount[]
  windowMs: number
  maxCount: number
  bucketSizeMs: number
  consume?: boolean
}

type ToolLimitStoreResult = {
  allowed: boolean
  code?: ToolPolicyCode
  message?: string
  retryAfterSeconds?: number
  scopeKey?: string
  remaining: number
}

export type ToolLimitStore = {
  checkAndConsume(input: ToolLimitStoreInput): Promise<ToolLimitStoreResult>
}

type ConvexToolLimitStoreOptions = {
  convexToken?: string
  anonymousId?: string
}

/**
 * ACCEPTED TOKEN-LIFETIME COUPLING (durable-turn gameplan §0, decided
 * 2026-07-19): this store deliberately rides the captured user token, not the
 * execution-grant worker wire — budget accounting is an admission-control
 * concern, not durable run state. If the token expires in the tail of a long
 * run, `checkAndConsume` rejects and the runtime degrades into the tested
 * bounded local cap (see the degraded-mode handling in lib/tools/runtime.ts) —
 * exactly the degradation the 2026-07-14 incident exercised. The cost is
 * degraded budget accounting for that tail; do not migrate this to the worker
 * wire without revisiting the decision.
 */
export function createConvexToolLimitStore(
  options: ConvexToolLimitStoreOptions
): ToolLimitStore {
  const { convexToken, anonymousId } = options

  return {
    async checkAndConsume(input) {
      try {
        const { actorKey: _actorKey, ...rest } = input
        const result = await fetchMutation(
          api.toolLimits.checkAndConsume,
          {
            ...rest,
            anonymousId,
          },
          { token: convexToken }
        )
        return {
          allowed: result.allowed,
          code: result.code as ToolPolicyCode | undefined,
          message: result.message,
          retryAfterSeconds: result.retryAfterSeconds,
          scopeKey: result.scopeKey,
          remaining: result.remaining,
        }
      } catch {
        throw new ToolPolicyError(
          "TOOL_POLICY_UNAVAILABLE: Tool policy service is unavailable. Retry in 30 seconds.",
          {
            code: "TOOL_POLICY_UNAVAILABLE",
            retryAfterSeconds: 30,
          }
        )
      }
    },
  }
}

export function getToolBudgetPolicy(
  toolName: string,
  keyMode: ToolKeyMode
): {
  windowMs: number
  maxCount: number
  bucketSizeMs: number
} {
  const modeLimits = TOOL_BUDGET_LIMITS[keyMode]
  const maxCount =
    modeLimits[toolName as keyof typeof modeLimits] ?? modeLimits.default

  return {
    windowMs: TOOL_BUDGET_WINDOW_MS,
    maxCount,
    bucketSizeMs: TOOL_LIMIT_BUCKET_SIZE_MS,
  }
}

export function getExtractContentDomainPolicy(): {
  windowMs: number
  maxCount: number
  bucketSizeMs: number
} {
  return {
    windowMs: EXTRACT_CONTENT_DOMAIN_WINDOW_MS,
    maxCount: EXTRACT_CONTENT_DOMAIN_MAX_REQUESTS,
    bucketSizeMs: TOOL_LIMIT_BUCKET_SIZE_MS,
  }
}

function toRetryHint(retryAfterSeconds?: number): string {
  if (!retryAfterSeconds) {
    return "Retry later with fewer tool calls."
  }
  return `Retry after approximately ${retryAfterSeconds} seconds.`
}

function formatDomainLimitCode(toolName: string): ToolDomainLimitCode {
  const normalizedToolName = toolName
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
  return `${normalizedToolName || "TOOL"}_DOMAIN_LIMIT_EXCEEDED`
}

export type ToolPolicyGuard = {
  enforceToolBudget(toolName: string): Promise<void>
  enforceExtractDomainLimit(domainCounts: Map<string, number>): Promise<void>
}

export async function probeToolBudget(options: {
  store: ToolLimitStore
  keyMode: ToolKeyMode
  toolName: string
  actorKey?: string
}): Promise<{
  allowed: boolean
  retryAfterSeconds?: number
  scopeKey?: string
}> {
  const { store, keyMode, toolName, actorKey } = options
  const policy = getToolBudgetPolicy(toolName, keyMode)
  const result = await store.checkAndConsume({
    actorKey,
    limitType: "budget",
    toolName,
    keyMode,
    scopeCounts: [{ scopeKey: "*", count: 1 }],
    ...policy,
    consume: false,
  })
  return {
    allowed: result.allowed,
    retryAfterSeconds: result.retryAfterSeconds,
    scopeKey: result.scopeKey,
  }
}

export function createToolPolicyGuard(options: {
  store: ToolLimitStore
  keyMode: ToolKeyMode
  actorKey?: string
}): ToolPolicyGuard {
  const { store, keyMode, actorKey } = options

  return {
    async enforceToolBudget(toolName: string): Promise<void> {
      const policy = getToolBudgetPolicy(toolName, keyMode)
      const result = await store.checkAndConsume({
        actorKey,
        limitType: "budget",
        toolName,
        keyMode,
        scopeCounts: [{ scopeKey: "*", count: 1 }],
        ...policy,
        consume: true,
      })

      if (!result.allowed) {
        const retryHint = toRetryHint(result.retryAfterSeconds)
        throw new ToolPolicyError(
          `TOOL_BUDGET_EXCEEDED: ${result.message ?? `Tool budget exceeded for ${toolName}.`} ${retryHint}`,
          {
            code: "TOOL_BUDGET_EXCEEDED",
            retryAfterSeconds: result.retryAfterSeconds,
            keyMode,
            scopeKey: result.scopeKey ?? "*",
            budgetDenied: true,
          }
        )
      }
    },

    async enforceExtractDomainLimit(
      domainCounts: Map<string, number>
    ): Promise<void> {
      if (domainCounts.size === 0) return

      const policy = getExtractContentDomainPolicy()
      const scopeCounts = Array.from(domainCounts.entries()).map(
        ([scopeKey, count]) => ({ scopeKey, count })
      )

      const result = await store.checkAndConsume({
        actorKey,
        limitType: "domain",
        toolName: "extract_content",
        keyMode,
        scopeCounts,
        ...policy,
        consume: true,
      })

      if (!result.allowed) {
        const retryHint = toRetryHint(result.retryAfterSeconds)
        throw new ToolPolicyError(
          `EXTRACT_CONTENT_DOMAIN_LIMIT_EXCEEDED: ${result.message ?? "Domain extraction limit exceeded."} ${retryHint} Use different domains or fewer URLs per domain.`,
          {
            code: "EXTRACT_CONTENT_DOMAIN_LIMIT_EXCEEDED",
            retryAfterSeconds: result.retryAfterSeconds,
            keyMode,
            scopeKey: result.scopeKey,
            budgetDenied: false,
          }
        )
      }
    },
  }
}

type InMemoryBucket = {
  count: number
  bucketStartMs: number
}

export class InMemoryToolLimitStore implements ToolLimitStore {
  private nowFn: () => number
  private buckets = new Map<string, InMemoryBucket>()

  constructor(nowFn: () => number = () => Date.now()) {
    this.nowFn = nowFn
  }

  async checkAndConsume(
    input: ToolLimitStoreInput
  ): Promise<ToolLimitStoreResult> {
    const now = this.nowFn()
    const currentBucketStartMs =
      Math.floor(now / input.bucketSizeMs) * input.bucketSizeMs
    const windowStartMs = now - input.windowMs + 1
    const firstBucketStartMs =
      Math.floor(windowStartMs / input.bucketSizeMs) * input.bucketSizeMs

    const scopes = input.scopeCounts.map((scope) => ({
      scopeKey: scope.scopeKey,
      count: Math.max(1, Math.trunc(scope.count)),
    }))

    for (const scope of scopes) {
      const totals = this.collectBuckets({
        actorKey: input.actorKey,
        limitType: input.limitType,
        toolName: input.toolName,
        keyMode: input.keyMode,
        scopeKey: scope.scopeKey,
        firstBucketStartMs,
        currentBucketStartMs,
      })

      const projected = totals.total + scope.count
      if (projected > input.maxCount) {
        const retryAfterMs = totals.oldestBucketStartMs
          ? Math.max(
              1_000,
              totals.oldestBucketStartMs +
                input.bucketSizeMs +
                input.windowMs -
                now
            )
          : input.windowMs

        return {
          allowed: false,
          code:
            input.limitType === "domain"
              ? formatDomainLimitCode(input.toolName)
              : "TOOL_BUDGET_EXCEEDED",
          message:
            input.limitType === "domain"
              ? `Too many "${input.toolName}" requests for domain "${scope.scopeKey}" in the active window.`
              : `Budget exceeded for "${input.toolName}" in the active window.`,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
          scopeKey: scope.scopeKey,
          remaining: Math.max(0, input.maxCount - totals.total),
        }
      }
    }

    if (input.consume !== false) {
      for (const scope of scopes) {
        const key = this.bucketKey({
          actorKey: input.actorKey,
          limitType: input.limitType,
          toolName: input.toolName,
          scopeKey: scope.scopeKey,
          keyMode: input.keyMode,
          bucketStartMs: currentBucketStartMs,
        })
        const existing = this.buckets.get(key)
        this.buckets.set(key, {
          bucketStartMs: currentBucketStartMs,
          count: (existing?.count ?? 0) + scope.count,
        })
      }
    }

    const minRemaining = scopes.reduce((min, scope) => {
      const totals = this.collectBuckets({
        actorKey: input.actorKey,
        limitType: input.limitType,
        toolName: input.toolName,
        keyMode: input.keyMode,
        scopeKey: scope.scopeKey,
        firstBucketStartMs,
        currentBucketStartMs,
      })
      return Math.min(min, Math.max(0, input.maxCount - totals.total))
    }, input.maxCount)

    return { allowed: true, remaining: minRemaining }
  }

  private bucketKey(input: {
    actorKey?: string
    limitType: ToolLimitType
    toolName: string
    scopeKey: string
    keyMode: ToolKeyMode
    bucketStartMs: number
  }): string {
    return [
      input.actorKey ?? "default",
      input.limitType,
      input.toolName,
      input.scopeKey,
      input.keyMode,
      input.bucketStartMs,
    ].join("::")
  }

  private collectBuckets(input: {
    actorKey?: string
    limitType: ToolLimitType
    toolName: string
    scopeKey: string
    keyMode: ToolKeyMode
    firstBucketStartMs: number
    currentBucketStartMs: number
  }): {
    total: number
    oldestBucketStartMs?: number
  } {
    const prefix = [
      input.actorKey ?? "default",
      input.limitType,
      input.toolName,
      input.scopeKey,
      input.keyMode,
      "",
    ].join("::")
    let total = 0
    let oldestBucketStartMs: number | undefined

    for (const [key, value] of this.buckets.entries()) {
      if (!key.startsWith(prefix)) continue
      if (
        value.bucketStartMs < input.firstBucketStartMs ||
        value.bucketStartMs > input.currentBucketStartMs
      ) {
        continue
      }
      total += value.count
      if (
        oldestBucketStartMs === undefined ||
        value.bucketStartMs < oldestBucketStartMs
      ) {
        oldestBucketStartMs = value.bucketStartMs
      }
    }

    return { total, oldestBucketStartMs }
  }
}
