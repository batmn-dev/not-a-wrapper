import type { ToolKeyMode } from "@/lib/user-keys"
import type { ToolSet } from "ai"
import {
  resolveToolCapabilities,
  type ToolCapabilities,
  type ToolSource,
} from "./types"

export type CapabilityAxis = "search" | "extract" | "code" | "mcp" | "platform"

export type ToolRiskLevel =
  | "read_only"
  | "stateful_non_destructive"
  | "destructive"
  | "open_world"
  | "unknown"

export type UserTier = "anonymous" | "authenticated"

export type ToolPolicyInput = {
  toolName: string
  source: ToolSource
  capability?: CapabilityAxis
  /**
   * Safety boundary for MCP annotations:
   * risk-driving hints are only consumed when explicitly trusted.
   */
  riskHintsTrusted?: boolean
  readOnly?: boolean
  destructive?: boolean
  idempotent?: boolean
  openWorld?: boolean
}

export type CapabilityReasonCode =
  | "model_enabled"
  | "model_disabled"
  | "anonymous_blocked"
  | "authenticated_allowed"

export type KeyModeReasonCode =
  "key_mode_byok" | "key_mode_platform" | "key_mode_unknown"

export type ToolPolicyReasonCode =
  | "allowed"
  | "capability_disabled"
  | "risk_unknown_early_step_block"
  | "risk_unknown_early_step_advisory_allow"
  | "risk_read_only_allowed"
  | "risk_stateful_late_step_block"
  | "risk_destructive_late_step_block"
  | "risk_open_world_late_step_block"
  | "risk_unknown_fail_closed"
  | "key_mode_byok_allowed"
  | "key_mode_platform_allowed"
  | "key_mode_unknown_fail_closed"

export type ToolPolicyDecision = {
  toolName: string
  source: ToolSource
  capability: CapabilityAxis
  risk: ToolRiskLevel
  allowInEarlySteps: boolean
  allowInLateSteps: boolean
  earlyReasonCode: ToolPolicyReasonCode
  lateReasonCode: ToolPolicyReasonCode
}

export type CapabilityPolicyResult = {
  userTier: UserTier
  keyMode?: ToolKeyMode
  keyModeReason: KeyModeReasonCode
  capabilities: Required<ToolCapabilities>
  capabilityReasons: Record<CapabilityAxis, CapabilityReasonCode>
  toolDecisions: ToolPolicyDecision[]
  earlyToolNames: string[]
  lateToolNames: string[]
}

type CapabilityPolicyOptions = {
  modelTools: boolean | ToolCapabilities | undefined
  isAuthenticated: boolean
  keyMode?: ToolKeyMode
  tools?: ToolPolicyInput[]
}

function resolveKeyModeReason(keyMode?: ToolKeyMode): KeyModeReasonCode {
  if (keyMode === "byok") return "key_mode_byok"
  if (keyMode === "platform") return "key_mode_platform"
  return "key_mode_unknown"
}

function classifyToolRisk(tool: ToolPolicyInput): ToolRiskLevel {
  const canUseHintsForRisk =
    tool.source !== "mcp" || tool.riskHintsTrusted === true
  if (!canUseHintsForRisk) {
    return "unknown"
  }

  if (tool.openWorld === true) return "open_world"
  if (tool.destructive === true) return "destructive"
  if (tool.readOnly === true) return "read_only"
  if (tool.readOnly === false) {
    return "stateful_non_destructive"
  }
  return "unknown"
}

function inferCapability(tool: ToolPolicyInput): CapabilityAxis {
  if (tool.capability) return tool.capability
  if (tool.source === "platform") return "platform"
  if (tool.source === "mcp") return "mcp"
  if (tool.toolName === "extract_content") return "extract"
  if (/code|execute|sandbox/i.test(tool.toolName)) return "code"
  return "search"
}

function computeCapabilityMatrix(options: CapabilityPolicyOptions): {
  userTier: UserTier
  capabilities: Required<ToolCapabilities>
  reasons: Record<CapabilityAxis, CapabilityReasonCode>
} {
  const userTier: UserTier = options.isAuthenticated
    ? "authenticated"
    : "anonymous"
  const modelCapabilities = resolveToolCapabilities(options.modelTools)
  const capabilities: Required<ToolCapabilities> = { ...modelCapabilities }
  const reasons: Record<CapabilityAxis, CapabilityReasonCode> = {
    search: modelCapabilities.search ? "model_enabled" : "model_disabled",
    extract: modelCapabilities.extract ? "model_enabled" : "model_disabled",
    code: modelCapabilities.code ? "model_enabled" : "model_disabled",
    mcp: modelCapabilities.mcp ? "model_enabled" : "model_disabled",
    platform: modelCapabilities.platform ? "model_enabled" : "model_disabled",
  }

  if (!options.isAuthenticated) {
    // Anonymous mode is fail-safe: no stateful/open-world capability classes.
    capabilities.code = false
    capabilities.mcp = false
    capabilities.platform = false
    reasons.code = "anonymous_blocked"
    reasons.mcp = "anonymous_blocked"
    reasons.platform = "anonymous_blocked"
  } else {
    if (capabilities.code) reasons.code = "authenticated_allowed"
    if (capabilities.mcp) reasons.mcp = "authenticated_allowed"
    if (capabilities.platform) reasons.platform = "authenticated_allowed"
  }

  return { userTier, capabilities, reasons }
}

function lateStepReasonForRisk(risk: ToolRiskLevel): ToolPolicyReasonCode {
  if (risk === "read_only") return "risk_read_only_allowed"
  if (risk === "stateful_non_destructive")
    return "risk_stateful_late_step_block"
  if (risk === "destructive") return "risk_destructive_late_step_block"
  if (risk === "open_world") return "risk_open_world_late_step_block"
  return "risk_unknown_fail_closed"
}

function resolveKeyModePolicyForTool(
  tool: ToolPolicyInput,
  keyMode?: ToolKeyMode
): {
  allow: boolean
  allowReason?: ToolPolicyReasonCode
  denyReason?: ToolPolicyReasonCode
} {
  // Key mode is only decision-driving for third-party tools where request-level
  // key provenance is explicit (BYOK vs platform budget envelope).
  if (tool.source !== "third-party") {
    return { allow: true }
  }

  if (keyMode === "byok") {
    return { allow: true, allowReason: "key_mode_byok_allowed" }
  }
  if (keyMode === "platform") {
    return { allow: true, allowReason: "key_mode_platform_allowed" }
  }
  return { allow: false, denyReason: "key_mode_unknown_fail_closed" }
}

export function resolveCapabilityPolicy(
  options: CapabilityPolicyOptions
): CapabilityPolicyResult {
  const { userTier, capabilities, reasons } = computeCapabilityMatrix(options)
  const toolDecisions: ToolPolicyDecision[] = []

  for (const tool of options.tools ?? []) {
    const capability = inferCapability(tool)
    const risk = classifyToolRisk(tool)
    const capabilityAllowed = capabilities[capability]
    const keyModePolicy = resolveKeyModePolicyForTool(tool, options.keyMode)
    const riskAllowedInEarlySteps =
      risk !== "unknown" || (tool.source === "mcp" && risk === "unknown")

    const allowInEarlySteps =
      capabilityAllowed && keyModePolicy.allow && riskAllowedInEarlySteps
    const earlyReasonCode: ToolPolicyReasonCode = !capabilityAllowed
      ? "capability_disabled"
      : !keyModePolicy.allow
        ? (keyModePolicy.denyReason ?? "key_mode_unknown_fail_closed")
        : !riskAllowedInEarlySteps
          ? "risk_unknown_early_step_block"
          : risk === "unknown" && tool.source === "mcp"
            ? "risk_unknown_early_step_advisory_allow"
            : (keyModePolicy.allowReason ?? "allowed")

    const allowInLateSteps =
      capabilityAllowed && keyModePolicy.allow && risk === "read_only"
    const lateReasonCode: ToolPolicyReasonCode = !capabilityAllowed
      ? "capability_disabled"
      : !keyModePolicy.allow
        ? (keyModePolicy.denyReason ?? "key_mode_unknown_fail_closed")
        : risk === "read_only" && keyModePolicy.allowReason
          ? keyModePolicy.allowReason
          : lateStepReasonForRisk(risk)

    toolDecisions.push({
      toolName: tool.toolName,
      source: tool.source,
      capability,
      risk,
      allowInEarlySteps,
      allowInLateSteps,
      earlyReasonCode,
      lateReasonCode,
    })
  }

  const earlyToolNames = toolDecisions
    .filter((decision) => decision.allowInEarlySteps)
    .map((decision) => decision.toolName)

  const lateToolNames = toolDecisions
    .filter((decision) => decision.allowInLateSteps)
    .map((decision) => decision.toolName)

  return {
    userTier,
    keyMode: options.keyMode,
    keyModeReason: resolveKeyModeReason(options.keyMode),
    capabilities,
    capabilityReasons: reasons,
    toolDecisions,
    earlyToolNames,
    lateToolNames,
  }
}

export function getActiveToolsForStep(
  policy: CapabilityPolicyResult,
  stepNumber: number,
  threshold: number
): string[] | undefined {
  if (stepNumber <= threshold) return policy.earlyToolNames
  return policy.lateToolNames
}

export function filterToolSetByPolicy(
  tools: ToolSet,
  policy: CapabilityPolicyResult
): ToolSet {
  const allowed = new Set(policy.earlyToolNames)
  const filtered: Record<string, unknown> = {}
  for (const [name, descriptor] of Object.entries(tools)) {
    if (allowed.has(name)) {
      filtered[name] = descriptor
    }
  }
  return filtered as ToolSet
}

export function filterMetadataMapByPolicy<T>(
  metadata: ReadonlyMap<string, T>,
  policy: CapabilityPolicyResult
): Map<string, T> {
  const allowed = new Set(policy.earlyToolNames)
  return new Map(
    Array.from(metadata.entries()).filter(([name]) => allowed.has(name))
  )
}
