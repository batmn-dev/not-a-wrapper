import { describe, expect, it } from "vitest"
import { createToolMetadataResolver } from "../metadata-resolver"
import { buildToolInvocationMetadataByName } from "../ui-metadata"
import type { ToolMetadata } from "../types"
import type { ServerInfo } from "@/lib/mcp/load-tools"

const builtInTool: ToolMetadata = {
  displayName: "Web Search",
  source: "builtin",
  serviceName: "OpenAI",
  icon: "search",
  readOnly: true,
  idempotent: true,
}

const thirdPartyTool: ToolMetadata = {
  displayName: "Exa Search",
  source: "third-party",
  serviceName: "Exa",
  icon: "search",
  estimatedCostPer1k: 5,
  readOnly: true,
  idempotent: true,
}

const contentTool: ToolMetadata = {
  displayName: "Extract Content",
  source: "third-party",
  serviceName: "Exa",
  icon: "extract",
  maxResultSize: 100_000,
  readOnly: true,
}

const mcpTool: ServerInfo = {
  displayName: "create_issue",
  serverName: "GitHub MCP",
  serverId: "server_123",
  readOnly: false,
  destructive: false,
  idempotent: true,
  openWorld: true,
  retrySafetyTrusted: true,
  policyHintsTrusted: true,
}

function buildResolver() {
  return createToolMetadataResolver({
    builtIn: new Map([["web_search", builtInTool]]),
    thirdParty: new Map([["exa_search", thirdPartyTool]]),
    content: new Map([["extract_content", contentTool]]),
    mcpToolServerMap: new Map([["github_create_issue", mcpTool]]),
  })
}

describe("createToolMetadataResolver — one resolved shape per source", () => {
  it("resolves a built-in (Layer 1) tool", () => {
    expect(buildResolver().get("web_search")).toEqual({
      displayName: "Web Search",
      source: "builtin",
      serviceName: "OpenAI",
      icon: "search",
      estimatedCostPer1k: undefined,
      maxResultSize: undefined,
      readOnly: true,
      destructive: undefined,
      idempotent: true,
      openWorld: undefined,
    })
  })

  it("resolves a third-party search (Layer 2) tool, preserving cost", () => {
    expect(buildResolver().get("exa_search")).toEqual({
      displayName: "Exa Search",
      source: "third-party",
      serviceName: "Exa",
      icon: "search",
      estimatedCostPer1k: 5,
      maxResultSize: undefined,
      readOnly: true,
      destructive: undefined,
      idempotent: true,
      openWorld: undefined,
    })
  })

  it("resolves a content-extraction (Layer 2) tool, preserving maxResultSize", () => {
    expect(buildResolver().get("extract_content")).toEqual({
      displayName: "Extract Content",
      source: "third-party",
      serviceName: "Exa",
      icon: "extract",
      estimatedCostPer1k: undefined,
      maxResultSize: 100_000,
      readOnly: true,
      destructive: undefined,
      idempotent: undefined,
      openWorld: undefined,
    })
  })

  it("resolves an MCP (Layer 3) tool: humanized name, serviceName = serverName, mcpServer carries the raw name", () => {
    expect(buildResolver().get("github_create_issue")).toEqual({
      displayName: "Create Issue",
      source: "mcp",
      serviceName: "GitHub MCP",
      icon: "wrench",
      readOnly: false,
      destructive: false,
      idempotent: true,
      openWorld: true,
      policyHintsTrusted: true,
      retrySafetyTrusted: true,
      mcpServer: {
        serverId: "server_123",
        serverName: "GitHub MCP",
        displayName: "create_issue",
      },
    })
  })
})

describe("createToolMetadataResolver — MCP risk hints are carried verbatim (not trust-filtered)", () => {
  it("keeps hints when policyHintsTrusted is true", () => {
    const resolved = buildResolver().get("github_create_issue")
    expect(resolved?.policyHintsTrusted).toBe(true)
    expect(resolved?.readOnly).toBe(false)
    expect(resolved?.destructive).toBe(false)
    expect(resolved?.idempotent).toBe(true)
    expect(resolved?.openWorld).toBe(true)
  })

  it("keeps hints verbatim even when policyHintsTrusted is false — call sites apply trust, not the resolver", () => {
    const resolver = createToolMetadataResolver({
      builtIn: new Map(),
      thirdParty: new Map(),
      content: new Map(),
      mcpToolServerMap: new Map([
        [
          "github_delete_repo",
          {
            displayName: "delete_repo",
            serverName: "GitHub MCP",
            serverId: "server_123",
            readOnly: false,
            destructive: true,
            idempotent: false,
            openWorld: true,
            retrySafetyTrusted: false,
            policyHintsTrusted: false,
          } satisfies ServerInfo,
        ],
      ]),
    })

    const resolved = resolver.get("github_delete_repo")
    expect(resolved?.policyHintsTrusted).toBe(false)
    expect(resolved?.retrySafetyTrusted).toBe(false)
    // Hints are NOT nulled out — they are retained for UI context and trust is
    // applied separately by getRuntimeToolApprovalDecision / the policy join.
    expect(resolved?.readOnly).toBe(false)
    expect(resolved?.destructive).toBe(true)
    expect(resolved?.idempotent).toBe(false)
    expect(resolved?.openWorld).toBe(true)
  })
})

describe("createToolMetadataResolver — unknown tools", () => {
  it("returns undefined consistently and falls back to platform source", () => {
    const resolver = buildResolver()
    expect(resolver.get("nonexistent")).toBeUndefined()
    // Mirrors the prior sourceForTool fallback for unknown tools.
    expect(resolver.source("nonexistent")).toBe("platform")
  })
})

describe("createToolMetadataResolver — precedence (documented effective behavior)", () => {
  it("non-MCP collisions: later spread wins (built-in → third-party → content), matching the prior merged Map", () => {
    const resolver = createToolMetadataResolver({
      builtIn: new Map([
        ["dup", { displayName: "From BuiltIn", source: "builtin", serviceName: "A" }],
      ]),
      thirdParty: new Map([
        ["dup", { displayName: "From ThirdParty", source: "third-party", serviceName: "B" }],
      ]),
      content: new Map([
        ["dup", { displayName: "From Content", source: "third-party", serviceName: "C" }],
      ]),
      mcpToolServerMap: new Map(),
    })

    expect(resolver.get("dup")?.displayName).toBe("From Content")
  })

  it("MCP wins over non-MCP for get()/source() (MCP is consulted first)", () => {
    const resolver = createToolMetadataResolver({
      builtIn: new Map([
        ["collide", { displayName: "Non MCP", source: "builtin", serviceName: "A" }],
      ]),
      thirdParty: new Map(),
      content: new Map(),
      mcpToolServerMap: new Map([
        [
          "collide",
          {
            displayName: "collide_raw",
            serverName: "Server",
            serverId: "id_1",
          } satisfies ServerInfo,
        ],
      ]),
    })

    expect(resolver.get("collide")?.source).toBe("mcp")
    expect(resolver.source("collide")).toBe("mcp")
  })
})

describe("createToolMetadataResolver — toInvocationMetadataByName", () => {
  it("matches buildToolInvocationMetadataByName byte-for-byte and never leaks resolver-only keys", () => {
    const resolver = buildResolver()
    const byName = resolver.toInvocationMetadataByName()

    expect(byName).toEqual(
      buildToolInvocationMetadataByName({
        nonMcpMetadata: new Map([
          ["web_search", builtInTool],
          ["exa_search", thirdPartyTool],
          ["extract_content", contentTool],
        ]),
        mcpToolServerMap: new Map([["github_create_issue", mcpTool]]),
      })
    )

    // MCP entry is humanized and stripped of resolver-only fields (the shape is
    // persisted/streamed, so it must stay ToolInvocationDisplayMetadata).
    expect(byName.github_create_issue.displayName).toBe("Create Issue")
    expect(byName.github_create_issue).not.toHaveProperty("mcpServer")
    expect(byName.github_create_issue).not.toHaveProperty("policyHintsTrusted")
    expect(byName.github_create_issue).not.toHaveProperty("retrySafetyTrusted")
  })
})
