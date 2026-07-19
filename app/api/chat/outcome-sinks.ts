// app/api/chat/outcome-sinks.ts
//
// Production Tool outcome sinks (see CONTEXT.md). Each factory closes over the
// request-scoped context the projection needs and returns a ToolOutcomeSink the
// route injects into prepareToolRuntime. The runtime assembles outcomes; sinks
// only project them onto a destination. Tests inject an in-memory sink instead —
// the seam's second adapter.

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { getPostHogClient } from "@/lib/posthog"
import type { ToolOutcomeSink } from "@/lib/tools/runtime"
import { fetchMutation } from "convex/nextjs"

type PostHogClient = NonNullable<ReturnType<typeof getPostHogClient>>

/**
 * Audit-log sink: persists every outcome to Convex `toolCallLog` (fire-and-
 * forget; failures are logged and swallowed so they never break the stream).
 *
 * ACCEPTED-LOSSY (durable-turn gameplan §0, decided 2026-07-19): this sink
 * deliberately rides the captured user token, not the execution-grant worker
 * wire — it writes audit rows, not durable run state. If the token expires in
 * the tail of a long run, the remaining rows are dropped and logged
 * (`tool_call_log_write_failed`). Do not migrate it to the worker wire without
 * revisiting that decision.
 */
export function createToolCallLogSink(options: {
  convexToken: string
  chatId: string
  requestId: string
  chatVersion: number
}): ToolOutcomeSink {
  const { convexToken, chatId, requestId, chatVersion } = options
  return (outcome) => {
    void fetchMutation(
      api.toolCallLog.log,
      {
        chatId: chatId as Id<"chats">,
        ...(outcome.mcpServer && {
          serverId: outcome.mcpServer.serverId as Id<"mcpServers">,
        }),
        toolName: outcome.displayName,
        toolCallId: outcome.toolCallId,
        inputPreview: outcome.inputPreview,
        outputPreview: outcome.outputPreview,
        success: outcome.success,
        durationMs: outcome.durationMs,
        error: outcome.error,
        source: outcome.source,
        serviceName: outcome.serviceName,
        stepNumber: outcome.stepNumber,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        resultSizeBytes: outcome.resultSizeBytes,
        requestId,
        errorCode: outcome.errorCode,
        retryAfterSeconds: outcome.retryAfterSeconds,
        budgetKeyMode: outcome.budgetKeyMode,
        budgetDenied: outcome.budgetDenied,
        chatVersion,
        toolKey: outcome.toolKey,
      },
      { token: convexToken }
    ).catch((err: unknown) => {
      console.warn(
        JSON.stringify({
          _tag: "tool_call_log_write_failed",
          requestId,
          chatId,
          toolCallId: outcome.toolCallId,
          toolName: outcome.displayName,
          source: outcome.source,
          stepNumber: outcome.stepNumber,
          error: err instanceof Error ? err.message : String(err),
        })
      )
    })
  }
}

/**
 * Analytics sink: one PostHog `tool_call` event per outcome, all sources.
 */
export function createPostHogToolCallSink(options: {
  phClient: PostHogClient
  distinctId: string
  chatId: string
  requestId: string
  chatVersion: number
}): ToolOutcomeSink {
  const { phClient, distinctId, chatId, requestId, chatVersion } = options
  return (outcome) => {
    phClient.capture({
      distinctId,
      event: "tool_call",
      properties: {
        toolName: outcome.displayName,
        rawToolName: outcome.toolKey,
        source: outcome.source,
        serviceName: outcome.serviceName,
        success: outcome.success,
        chatId,
        chatVersion,
        durationMs: outcome.durationMs ?? undefined,
        errorCode: outcome.errorCode,
        retryAfterSeconds: outcome.retryAfterSeconds,
        budgetKeyMode: outcome.budgetKeyMode,
        budgetDenied: outcome.budgetDenied,
        requestId,
        ...(outcome.mcpServer && {
          serverId: outcome.mcpServer.serverId,
          serverName: outcome.mcpServer.serverName,
        }),
      },
    })
  }
}

/**
 * Trace-log sink: one structured `tool_trace` line per outcome — parseable by
 * the Vercel log drain and grep.
 */
export function createToolTraceLogSink(options: {
  requestId: string
  chatId: string
  userId: string
  model: string
}): ToolOutcomeSink {
  const { requestId, chatId, userId, model } = options
  return (outcome) => {
    console.log(
      JSON.stringify({
        _tag: "tool_trace",
        requestId,
        chatId,
        userId,
        step: outcome.stepNumber,
        tool: outcome.displayName,
        source: outcome.source,
        success: outcome.success,
        durationMs: outcome.durationMs ?? null,
        estimatedCostPer1k: outcome.estimatedCostPer1k ?? null,
        errorCode: outcome.errorCode ?? null,
        retryAfterSeconds: outcome.retryAfterSeconds ?? null,
        budgetKeyMode: outcome.budgetKeyMode ?? null,
        budgetDenied: outcome.budgetDenied ?? null,
        tokens: {
          in: outcome.inputTokens ?? null,
          out: outcome.outputTokens ?? null,
        },
        finishReason: outcome.finishReason,
        model,
      })
    )
  }
}
