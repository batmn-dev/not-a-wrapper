import { describe, expect, it } from "vitest"
import { getRuntimeToolApprovalDecision } from "../runtime-approval"

describe("runtime tool approval policy", () => {
  it("allows trusted read-only tools without runtime approval", () => {
    const decision = getRuntimeToolApprovalDecision({
      toolName: "web_search",
      source: "third-party",
      metadata: {
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: false,
      },
      riskHintsTrusted: true,
    })

    expect(decision.needsApproval).toBe(false)
    expect(decision.riskClass).toBe("read_only")
  })

  it("requires approval for destructive tools", () => {
    const decision = getRuntimeToolApprovalDecision({
      toolName: "delete_project",
      source: "platform",
      metadata: {
        readOnly: false,
        destructive: true,
        idempotent: false,
      },
      riskHintsTrusted: true,
    })

    expect(decision.needsApproval).toBe(true)
    expect(decision.riskClass).toBe("destructive")
  })

  it("requires approval for untrusted MCP tools even when hints look safe", () => {
    const decision = getRuntimeToolApprovalDecision({
      toolName: "mcp_read_customer",
      source: "mcp",
      metadata: {
        readOnly: true,
        destructive: false,
        idempotent: true,
      },
      riskHintsTrusted: false,
    })

    expect(decision.needsApproval).toBe(true)
    expect(decision.riskClass).toBe("mcp_unknown")
  })

  it("requires approval for external writes inferred from tool names", () => {
    const decision = getRuntimeToolApprovalDecision({
      toolName: "send_email",
      source: "mcp",
      metadata: {
        readOnly: true,
        destructive: false,
      },
      riskHintsTrusted: true,
    })

    expect(decision.needsApproval).toBe(true)
    expect(decision.riskClass).toBe("email")
  })
})
