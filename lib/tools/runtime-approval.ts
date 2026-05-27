import type { ToolMetadata, ToolSource } from "./types"

export type RuntimeToolApprovalRisk =
  | "read_only"
  | "stateful"
  | "destructive"
  | "payment"
  | "email"
  | "credential"
  | "external_write"
  | "account_management"
  | "mcp_unknown"
  | "unknown"

export type RuntimeToolApprovalDecision = {
  needsApproval: boolean
  riskClass: RuntimeToolApprovalRisk
  reason: string
}

type RuntimeToolApprovalInput = {
  toolName: string
  source: ToolSource
  metadata?: Pick<
    ToolMetadata,
    "readOnly" | "destructive" | "idempotent" | "openWorld"
  >
  riskHintsTrusted?: boolean
}

const PAYMENT_PATTERN =
  /\b(pay|payment|purchase|order|checkout|invoice|billing|charge|refund|transfer|funds?)\b/i
const EMAIL_PATTERN =
  /\b(email|mail|message|sms|slack|send|notify|publish|post|tweet)\b/i
const CREDENTIAL_PATTERN =
  /\b(secret|token|credential|password|api[_-]?key|auth|oauth|session)\b/i
const ACCOUNT_PATTERN =
  /\b(account|user|member|permission|role|setting|config|admin)\b/i
const DESTRUCTIVE_PATTERN =
  /\b(delete|remove|destroy|drop|erase|revoke|disable|cancel|terminate|overwrite)\b/i
const WRITE_PATTERN =
  /\b(create|update|write|edit|mutate|insert|upsert|patch|commit|deploy|merge|upload)\b/i

function classifyName(toolName: string): RuntimeToolApprovalRisk | null {
  const normalized = toolName.replace(/[_-]+/g, " ")
  if (PAYMENT_PATTERN.test(normalized)) return "payment"
  if (CREDENTIAL_PATTERN.test(normalized)) return "credential"
  if (DESTRUCTIVE_PATTERN.test(normalized)) return "destructive"
  if (EMAIL_PATTERN.test(normalized)) return "email"
  if (ACCOUNT_PATTERN.test(normalized)) return "account_management"
  if (WRITE_PATTERN.test(normalized)) return "external_write"
  return null
}

export function getRuntimeToolApprovalDecision(
  input: RuntimeToolApprovalInput
): RuntimeToolApprovalDecision {
  const metadata = input.metadata
  const nameRisk = classifyName(input.toolName)

  if (metadata?.destructive === true || nameRisk === "destructive") {
    return {
      needsApproval: true,
      riskClass: "destructive",
      reason: "Tool can delete, overwrite, or otherwise destructively mutate state.",
    }
  }

  if (nameRisk) {
    return {
      needsApproval: true,
      riskClass: nameRisk,
      reason: `Tool name indicates ${nameRisk.replace(/_/g, " ")} risk.`,
    }
  }

  if (input.source === "mcp" && input.riskHintsTrusted !== true) {
    return {
      needsApproval: true,
      riskClass: "mcp_unknown",
      reason: "MCP tool risk hints are untrusted for this server.",
    }
  }

  if (metadata?.readOnly === false) {
    if (metadata.idempotent === false || metadata.openWorld === true) {
      return {
        needsApproval: true,
        riskClass: "external_write",
        reason:
          "Tool is not read-only and may mutate external or non-idempotent state.",
      }
    }
    return {
      needsApproval: true,
      riskClass: "stateful",
      reason: "Tool is not read-only.",
    }
  }

  if (metadata?.readOnly === true) {
    return {
      needsApproval: false,
      riskClass: "read_only",
      reason: "Tool is read-only.",
    }
  }

  return {
    needsApproval: input.source === "mcp",
    riskClass: "unknown",
    reason:
      input.source === "mcp"
        ? "MCP tool risk is unknown."
        : "No runtime approval risk signal matched.",
  }
}
