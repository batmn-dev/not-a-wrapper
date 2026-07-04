import { describe, expect, it } from "vitest"
import {
  filterMetadataMapByPolicy,
  filterToolSetByPolicy,
  getActiveToolsForStep,
  resolveCapabilityPolicy,
  type ToolPolicyInput,
} from "../capability-policy"

function policyFor(
  tools: ToolPolicyInput[],
  options?: {
    isAuthenticated?: boolean
    modelTools?:
      | boolean
      | {
          search?: boolean
          extract?: boolean
          code?: boolean
          mcp?: boolean
          platform?: boolean
        }
    keyMode?: "platform" | "byok"
  }
) {
  return resolveCapabilityPolicy({
    modelTools: options?.modelTools,
    isAuthenticated: options?.isAuthenticated ?? true,
    keyMode: options?.keyMode,
    tools,
  })
}

describe("capability policy matrix", () => {
  it("blocks anonymous users from risky capability classes", () => {
    const policy = policyFor(
      [
        {
          toolName: "web_search",
          source: "third-party",
          capability: "search",
          readOnly: true,
        },
        {
          toolName: "extract_content",
          source: "third-party",
          capability: "extract",
          readOnly: true,
        },
        {
          toolName: "github_create_issue",
          source: "mcp",
          capability: "mcp",
          readOnly: false,
        },
        {
          toolName: "create_ticket",
          source: "platform",
          capability: "platform",
          readOnly: false,
        },
      ],
      { isAuthenticated: false, modelTools: true }
    )

    expect(policy.capabilities.search).toBe(true)
    expect(policy.capabilities.extract).toBe(true)
    expect(policy.capabilities.code).toBe(false)
    expect(policy.capabilities.mcp).toBe(false)
    expect(policy.capabilities.platform).toBe(false)

    const mcpDecision = policy.toolDecisions.find(
      (d) => d.toolName === "github_create_issue"
    )
    const platformDecision = policy.toolDecisions.find(
      (d) => d.toolName === "create_ticket"
    )
    expect(mcpDecision?.allowInEarlySteps).toBe(false)
    expect(platformDecision?.allowInEarlySteps).toBe(false)
  })

  it("does not block safe tools when key mode changes", () => {
    const tools: ToolPolicyInput[] = [
      {
        toolName: "web_search",
        source: "third-party",
        capability: "search",
        readOnly: true,
        idempotent: true,
      },
    ]

    const byok = policyFor(tools, {
      isAuthenticated: true,
      modelTools: true,
      keyMode: "byok",
    })
    const platform = policyFor(tools, {
      isAuthenticated: true,
      modelTools: true,
      keyMode: "platform",
    })

    expect(byok.earlyToolNames).toContain("web_search")
    expect(byok.lateToolNames).toContain("web_search")
    expect(platform.earlyToolNames).toContain("web_search")
    expect(platform.lateToolNames).toContain("web_search")
    expect(byok.toolDecisions[0]?.earlyReasonCode).toBe("key_mode_byok_allowed")
    expect(platform.toolDecisions[0]?.earlyReasonCode).toBe(
      "key_mode_platform_allowed"
    )
  })

  it("fails closed for third-party tools when key mode is unknown", () => {
    const policy = policyFor(
      [
        {
          toolName: "web_search",
          source: "third-party",
          capability: "search",
          readOnly: true,
        },
      ],
      { isAuthenticated: true, modelTools: true }
    )

    expect(policy.earlyToolNames).not.toContain("web_search")
    expect(policy.lateToolNames).not.toContain("web_search")
    expect(policy.toolDecisions[0]?.earlyReasonCode).toBe(
      "key_mode_unknown_fail_closed"
    )
    expect(policy.toolDecisions[0]?.lateReasonCode).toBe(
      "key_mode_unknown_fail_closed"
    )
  })

  it("honors model capability opt-outs", () => {
    const policy = policyFor(
      [
        {
          toolName: "web_search",
          source: "builtin",
          capability: "search",
          readOnly: true,
        },
        {
          toolName: "extract_content",
          source: "third-party",
          capability: "extract",
          readOnly: true,
        },
      ],
      {
        isAuthenticated: true,
        modelTools: {
          search: false,
          extract: true,
          code: true,
          mcp: true,
          platform: true,
        },
        keyMode: "platform",
      }
    )

    const searchDecision = policy.toolDecisions.find(
      (d) => d.toolName === "web_search"
    )
    const extractDecision = policy.toolDecisions.find(
      (d) => d.toolName === "extract_content"
    )

    expect(policy.capabilities.search).toBe(false)
    expect(searchDecision?.allowInEarlySteps).toBe(false)
    expect(extractDecision?.allowInEarlySteps).toBe(true)
  })

  it("enforces risk-based late-step restrictions", () => {
    const policy = policyFor(
      [
        {
          toolName: "web_search",
          source: "builtin",
          capability: "search",
          readOnly: true,
        },
        {
          toolName: "read_ticket_status",
          source: "platform",
          capability: "platform",
          readOnly: true,
        },
        {
          toolName: "create_ticket",
          source: "platform",
          capability: "platform",
          readOnly: false,
          destructive: false,
        },
        {
          toolName: "filesystem_delete",
          source: "mcp",
          capability: "mcp",
          readOnly: false,
          destructive: true,
        },
      ],
      { isAuthenticated: true, modelTools: true }
    )

    const afterThreshold = getActiveToolsForStep(policy, 5, 3) ?? []
    expect(afterThreshold).toContain("web_search")
    expect(afterThreshold).toContain("read_ticket_status")
    expect(afterThreshold).not.toContain("create_ticket")
    expect(afterThreshold).not.toContain("filesystem_delete")
  })

  it("treats unknown MCP risk as advisory in early steps and fail-closed in late steps", () => {
    const policy = policyFor(
      [
        {
          toolName: "github_unknown_tool",
          source: "mcp",
          capability: "mcp",
        },
      ],
      { isAuthenticated: true, modelTools: true }
    )

    const decision = policy.toolDecisions[0]
    expect(decision.risk).toBe("unknown")
    expect(decision.allowInEarlySteps).toBe(true)
    expect(decision.allowInLateSteps).toBe(false)
    expect(decision.earlyReasonCode).toBe(
      "risk_unknown_early_step_advisory_allow"
    )
    expect(decision.lateReasonCode).toBe("risk_unknown_fail_closed")
  })

  it("only trusts MCP risk hints when explicitly marked trusted", () => {
    const policy = policyFor(
      [
        {
          toolName: "mcp_untrusted_read",
          source: "mcp",
          capability: "mcp",
          readOnly: true,
          riskHintsTrusted: false,
        },
        {
          toolName: "mcp_trusted_read",
          source: "mcp",
          capability: "mcp",
          readOnly: true,
          riskHintsTrusted: true,
        },
      ],
      { isAuthenticated: true, modelTools: true }
    )

    const untrusted = policy.toolDecisions.find(
      (d) => d.toolName === "mcp_untrusted_read"
    )
    const trusted = policy.toolDecisions.find(
      (d) => d.toolName === "mcp_trusted_read"
    )

    expect(untrusted?.risk).toBe("unknown")
    expect(untrusted?.allowInLateSteps).toBe(false)
    expect(untrusted?.lateReasonCode).toBe("risk_unknown_fail_closed")

    expect(trusted?.risk).toBe("read_only")
    expect(trusted?.allowInLateSteps).toBe(true)
    expect(trusted?.lateReasonCode).toBe("risk_read_only_allowed")
  })

  it("blocks open-world tools in late steps even when read-only", () => {
    const policy = policyFor(
      [
        {
          toolName: "web_search",
          source: "builtin",
          capability: "search",
          readOnly: true,
          openWorld: true,
        },
        {
          toolName: "extract_content",
          source: "third-party",
          capability: "extract",
          readOnly: true,
          openWorld: true,
        },
      ],
      { isAuthenticated: true, modelTools: true, keyMode: "platform" }
    )

    expect(policy.earlyToolNames).toContain("web_search")
    expect(policy.earlyToolNames).toContain("extract_content")
    expect(policy.lateToolNames).not.toContain("web_search")
    expect(policy.lateToolNames).not.toContain("extract_content")

    const searchDecision = policy.toolDecisions.find(
      (d) => d.toolName === "web_search"
    )
    expect(searchDecision?.risk).toBe("open_world")
    expect(searchDecision?.lateReasonCode).toBe(
      "risk_open_world_late_step_block"
    )
  })

  it("applies centralized policy output to early filtering and late gating", () => {
    const tools: ToolPolicyInput[] = [
      {
        toolName: "web_search",
        source: "third-party",
        capability: "search",
        readOnly: true,
      },
      {
        toolName: "github_create_issue",
        source: "mcp",
        capability: "mcp",
        readOnly: false,
      },
      {
        toolName: "unknown_tool",
        source: "mcp",
        capability: "mcp",
      },
    ]
    const policy = policyFor(tools, {
      isAuthenticated: true,
      modelTools: true,
      keyMode: "platform",
    })

    const allTools = {
      web_search: { description: "search" },
      github_create_issue: { description: "issue" },
      unknown_tool: { description: "unknown" },
    } as unknown as import("ai").ToolSet

    const filteredTools = filterToolSetByPolicy(allTools, policy)
    expect(Object.keys(filteredTools)).toEqual([
      "web_search",
      "github_create_issue",
      "unknown_tool",
    ])

    const metadata = new Map([
      ["web_search", { source: "third-party" }],
      ["github_create_issue", { source: "mcp" }],
      ["unknown_tool", { source: "mcp" }],
    ])
    const filteredMetadata = filterMetadataMapByPolicy(metadata, policy)
    expect(Array.from(filteredMetadata.keys())).toEqual([
      "web_search",
      "github_create_issue",
      "unknown_tool",
    ])

    // After threshold, late-step tools should come from centralized late allow-list.
    expect(getActiveToolsForStep(policy, 1, 3)).toEqual([
      "web_search",
      "github_create_issue",
      "unknown_tool",
    ])
    expect(getActiveToolsForStep(policy, 5, 3)).toEqual(["web_search"])
  })
})
