import {
  getToolName,
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolSet,
  type ToolUIPart,
  type UIMessage,
} from "ai"
import { PublicChatHttpError } from "./public-http-error"

/**
 * Approval continuation: the one module that decides whether a request's
 * trailing assistant message carries a live approval response and what the
 * responses are. The Chat turn runtime gates and splits history through it;
 * the Durable turn runtime persists responses through it. One predicate, so
 * a part is a continuation for both runtimes or for neither.
 */

export type ApprovalRespondedPart = (ToolUIPart | DynamicToolUIPart) & {
  state: "approval-responded"
  approval: { id: string; approved: boolean; reason?: string }
}

export type ApprovalResponseForPersistence = {
  messageId: string
  approvalId: string
  toolCallId: string
  toolName: string
  approved: boolean
  reason?: string
}

export type ApprovalContinuationSplit = {
  history: UIMessage[]
  tail: UIMessage[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasApprovalRespondedState(
  part: UIMessage["parts"][number]
): part is (ToolUIPart | DynamicToolUIPart) & { state: "approval-responded" } {
  // MCP approvals stream as dynamic-tool parts, so this must accept both tool
  // part shapes.
  return isToolUIPart(part) && part.state === "approval-responded"
}

function isApprovalRespondedPart(
  part: UIMessage["parts"][number]
): part is ApprovalRespondedPart {
  return (
    hasApprovalRespondedState(part) &&
    typeof part.approval?.id === "string" &&
    typeof part.approval.approved === "boolean"
  )
}

function malformedApproval(): PublicChatHttpError {
  return new PublicChatHttpError({
    statusCode: 400,
    code: "INVALID_REQUEST",
    message: "An approval response is missing its approval id.",
  })
}

/**
 * The trailing assistant message's approval responses, or undefined when the
 * request is not a continuation. Only the trailing assistant can continue:
 * historical responses are persisted evidence and must not reclassify later
 * sends. A responded part without a well-formed approval is untrusted wire
 * input and is rejected here, before either runtime can read it differently.
 */
export function readApprovalContinuation(
  messages: readonly UIMessage[]
): { message: UIMessage; parts: ApprovalRespondedPart[] } | undefined {
  const trailingMessage = messages[messages.length - 1]
  if (!trailingMessage || trailingMessage.role !== "assistant") {
    return undefined
  }
  const parts: ApprovalRespondedPart[] = []
  for (const part of trailingMessage.parts) {
    if (!hasApprovalRespondedState(part)) continue
    if (!isApprovalRespondedPart(part)) throw malformedApproval()
    parts.push(part)
  }
  return parts.length > 0 ? { message: trailingMessage, parts } : undefined
}

export function extractApprovalResponses(
  messages: readonly UIMessage[]
): ApprovalResponseForPersistence[] {
  const continuation = readApprovalContinuation(messages)
  if (!continuation) return []
  return continuation.parts.map((part) => ({
    messageId: continuation.message.id,
    approvalId: part.approval.id,
    toolCallId: part.toolCallId,
    toolName: String(getToolName(part)),
    approved: part.approval.approved,
    ...(part.approval.reason ? { reason: part.approval.reason } : {}),
  }))
}

function getOriginProvider(message: UIMessage): string | undefined {
  if (!isRecord(message.metadata)) return undefined
  const provider = message.metadata.provider
  return typeof provider === "string" && provider.length > 0
    ? provider
    : undefined
}

function ownTool(
  tools: ToolSet,
  toolName: string
): ToolSet[string] | undefined {
  return Object.prototype.hasOwnProperty.call(tools, toolName)
    ? tools[toolName]
    : undefined
}

function providerConflict(): PublicChatHttpError {
  return new PublicChatHttpError({
    statusCode: 409,
    code: "APPROVAL_PROVIDER_MISMATCH",
    message:
      "This approval belongs to a different provider. Switch back to the original model and try again.",
  })
}

function toolUnavailable(): PublicChatHttpError {
  return new PublicChatHttpError({
    statusCode: 409,
    code: "APPROVAL_TOOL_UNAVAILABLE",
    message:
      "The tool for this approval is no longer available. Re-enable the tool and try again.",
  })
}

function assertContinuationPart(options: {
  part: ApprovalRespondedPart
  originProvider?: string
  targetProvider: string
  tools: ToolSet
}): void {
  const { part, originProvider, targetProvider, tools } = options
  if (!originProvider || originProvider !== targetProvider) {
    throw providerConflict()
  }

  const toolName = getToolName(part)
  const registeredTool = toolName ? ownTool(tools, toolName) : undefined
  if (!registeredTool) throw toolUnavailable()

  const partIsProviderExecuted = part.providerExecuted === true
  const toolIsProviderExecuted = registeredTool.isProviderExecuted === true
  if (partIsProviderExecuted !== toolIsProviderExecuted) {
    throw toolUnavailable()
  }

  if (partIsProviderExecuted) {
    if (
      registeredTool.type !== "provider" ||
      typeof registeredTool.id !== "string" ||
      !registeredTool.id.startsWith(`${targetProvider}.`)
    ) {
      throw toolUnavailable()
    }
  } else if (
    (part.type === "dynamic-tool") !== (registeredTool.type === "dynamic")
  ) {
    throw toolUnavailable()
  }
}

/**
 * Separate and validate the live approval response at the end of a request.
 * The tail is exempt from historical projection only after provider, registry,
 * execution-kind, and provider-tool identity continuity are proven. The Chat
 * turn runtime runs this at two boundaries on purpose: on the wire messages
 * before durable-prepare mutates approval state, and again on the canonical
 * history durable-prepare returns.
 */
export function splitAndValidateApprovalContinuation(options: {
  messages: readonly UIMessage[]
  targetProvider: string
  tools: ToolSet
}): ApprovalContinuationSplit {
  const { messages, targetProvider, tools } = options
  const continuation = readApprovalContinuation(messages)
  if (!continuation) {
    return { history: [...messages], tail: [] }
  }

  const originProvider = getOriginProvider(continuation.message)
  for (const part of continuation.parts) {
    assertContinuationPart({
      part,
      originProvider,
      targetProvider,
      tools,
    })
  }

  const approvalParts = new Set<UIMessage["parts"][number]>(continuation.parts)
  const historicalParts = continuation.message.parts.filter(
    (part) => !approvalParts.has(part)
  )
  const history = messages.slice(0, -1)
  if (historicalParts.length > 0) {
    history.push({ ...continuation.message, parts: historicalParts })
  }

  return {
    history,
    tail: [{ ...continuation.message, parts: continuation.parts }],
  }
}
