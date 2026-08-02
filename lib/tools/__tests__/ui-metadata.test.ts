import { describe, expect, it } from "vitest"
import {
  buildFinishToolInvocationStreamMetadata,
  buildStartToolInvocationStreamMetadata,
  humanizeToolName,
  resolveToolInvocationMetadata,
} from "../ui-metadata"

describe("humanizeToolName", () => {
  it("converts snake/camel case names to readable labels", () => {
    expect(humanizeToolName("github_create_issue")).toBe("Github Create Issue")
    expect(humanizeToolName("readFileFromRepo")).toBe("Read File From Repo")
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
        workDurationMs: 436,
      })
    ).toEqual({ workDurationMs: 436 })
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
        workDurationMs: 5678,
      })
    ).toEqual({
      toolMetadataByCallId: byCallId,
      reasoningDurationMs: 1234,
      workDurationMs: 5678,
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
