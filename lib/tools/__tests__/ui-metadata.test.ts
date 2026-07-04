import type { ServerInfo } from "@/lib/mcp/load-tools"
import { describe, expect, it } from "vitest"
import type { ToolMetadata } from "../types"
import {
  buildFinishToolInvocationStreamMetadata,
  buildStartToolInvocationStreamMetadata,
  buildToolInvocationMetadataByName,
  humanizeToolName,
  resolveToolInvocationMetadata,
} from "../ui-metadata"

describe("humanizeToolName", () => {
  it("converts snake/camel case names to readable labels", () => {
    expect(humanizeToolName("github_create_issue")).toBe("Github Create Issue")
    expect(humanizeToolName("readFileFromRepo")).toBe("Read File From Repo")
  })
})

describe("buildToolInvocationMetadataByName", () => {
  it("merges non-MCP and MCP metadata into transport-safe shape", () => {
    const nonMcpMetadata = new Map<string, ToolMetadata>([
      [
        "web_search",
        {
          displayName: "Web Search",
          source: "third-party",
          serviceName: "Exa",
          icon: "search",
          estimatedCostPer1k: 5,
          readOnly: true,
          idempotent: true,
        },
      ],
    ])

    const mcpToolServerMap = new Map<string, ServerInfo>([
      [
        "github_create_issue",
        {
          displayName: "create_issue",
          serverName: "GitHub MCP",
          serverId: "server_123",
          readOnly: false,
          destructive: false,
          idempotent: true,
          openWorld: true,
        },
      ],
    ])

    const metadata = buildToolInvocationMetadataByName({
      nonMcpMetadata,
      mcpToolServerMap,
    })

    expect(metadata.web_search).toEqual({
      displayName: "Web Search",
      source: "third-party",
      serviceName: "Exa",
      icon: "search",
      estimatedCostPer1k: 5,
      readOnly: true,
      destructive: undefined,
      idempotent: true,
      openWorld: undefined,
    })

    expect(metadata.github_create_issue).toEqual({
      displayName: "Create Issue",
      source: "mcp",
      serviceName: "GitHub MCP",
      icon: "wrench",
      estimatedCostPer1k: undefined,
      readOnly: false,
      destructive: false,
      idempotent: true,
      openWorld: true,
    })
  })
})

describe("tool invocation stream metadata", () => {
  it("emits by-name metadata only in start payload", () => {
    const byName = {
      web_search: {
        displayName: "Web Search",
        source: "third-party" as const,
        serviceName: "Exa",
        icon: "search" as const,
      },
    }

    expect(buildStartToolInvocationStreamMetadata(byName)).toEqual({
      toolMetadataByName: byName,
    })
    expect(
      buildFinishToolInvocationStreamMetadata({
        toolMetadataByCallId: {},
        reasoningDurationMs: null,
      })
    ).toEqual({})
  })

  it("emits finish payload only for call-id metadata and reasoning duration", () => {
    const byCallId = {
      call_1: {
        displayName: "Web Search",
        source: "third-party" as const,
        serviceName: "Exa",
        icon: "search" as const,
      },
    }

    expect(
      buildFinishToolInvocationStreamMetadata({
        toolMetadataByCallId: byCallId,
        reasoningDurationMs: 1234,
      })
    ).toEqual({
      toolMetadataByCallId: byCallId,
      reasoningDurationMs: 1234,
    })
  })

  it("resolves metadata by call-id first, then tool name fallback", () => {
    const resolvedByCallId = resolveToolInvocationMetadata({
      toolName: "web_search",
      toolCallId: "call_1",
      streamMetadata: {
        toolMetadataByName: {
          web_search: {
            displayName: "By Name",
            source: "third-party",
            serviceName: "Exa",
          },
        },
        toolMetadataByCallId: {
          call_1: {
            displayName: "By Call ID",
            source: "third-party",
            serviceName: "Exa",
          },
        },
      },
    })
    expect(resolvedByCallId?.displayName).toBe("By Call ID")

    const fallbackByName = resolveToolInvocationMetadata({
      toolName: "web_search",
      toolCallId: "missing",
      streamMetadata: {
        toolMetadataByName: {
          web_search: {
            displayName: "By Name",
            source: "third-party",
            serviceName: "Exa",
          },
        },
      },
    })
    expect(fallbackByName?.displayName).toBe("By Name")
  })
})
