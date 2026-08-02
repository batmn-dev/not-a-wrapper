import { isToolUIPart, type ToolSet, type UIMessage } from "ai"
import { PublicChatHttpError } from "./public-http-error"

type ApprovalRespondedPart = UIMessage["parts"][number] & {
  type: string
  toolName?: string
  providerExecuted?: boolean
  state: "approval-responded"
}

export type ApprovalContinuationSplit = {
  history: UIMessage[]
  tail: UIMessage[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isApprovalRespondedPart(
  part: UIMessage["parts"][number]
): part is ApprovalRespondedPart {
  return isToolUIPart(part) && part.state === "approval-responded"
}

function getToolName(part: ApprovalRespondedPart): string | undefined {
  if (part.type === "dynamic-tool") {
    return typeof part.toolName === "string" && part.toolName.length > 0
      ? part.toolName
      : undefined
  }
  return part.type.startsWith("tool-")
    ? part.type.slice("tool-".length)
    : undefined
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
 * execution-kind, and provider-tool identity continuity are proven.
 */
export function splitAndValidateApprovalContinuation(options: {
  messages: readonly UIMessage[]
  targetProvider: string
  tools: ToolSet
}): ApprovalContinuationSplit {
  const { messages, targetProvider, tools } = options
  const trailingMessage = messages[messages.length - 1]
  if (!trailingMessage || trailingMessage.role !== "assistant") {
    return { history: [...messages], tail: [] }
  }

  const approvalParts = trailingMessage.parts.filter(isApprovalRespondedPart)
  if (approvalParts.length === 0) {
    return { history: [...messages], tail: [] }
  }

  const originProvider = getOriginProvider(trailingMessage)
  for (const part of approvalParts) {
    assertContinuationPart({
      part,
      originProvider,
      targetProvider,
      tools,
    })
  }

  const historicalParts = trailingMessage.parts.filter(
    (part) => !isApprovalRespondedPart(part)
  )
  const history = messages.slice(0, -1)
  if (historicalParts.length > 0) {
    history.push({ ...trailingMessage, parts: historicalParts })
  }

  return {
    history,
    tail: [{ ...trailingMessage, parts: approvalParts }],
  }
}
