import { describe, expect, it } from "vitest"
import {
  collectGlobalCollisions,
  collectInvalidToolNames,
  enforceToolNamingGovernance,
  validateToolName,
  type ToolLayerMap,
} from "../naming"

function makeToolSet(keys: string[]): import("ai").ToolSet {
  return Object.fromEntries(
    keys.map((key) => [key, {}])
  ) as unknown as import("ai").ToolSet
}

describe("validateToolName", () => {
  it("accepts valid tool names", () => {
    expect(validateToolName("web_search")).toEqual({ valid: true })
    expect(validateToolName("extract-content.v2")).toEqual({ valid: true })
    expect(validateToolName("A1")).toEqual({ valid: true })
  })

  it("rejects invalid names", () => {
    expect(validateToolName("")).toEqual({
      valid: false,
      reason: "length must be 1..128",
    })
    expect(validateToolName("space invalid")).toEqual({
      valid: false,
      reason: "allowed characters are ASCII letters, digits, '_', '-', '.'",
    })
    expect(validateToolName("slash/invalid")).toEqual({
      valid: false,
      reason: "allowed characters are ASCII letters, digits, '_', '-', '.'",
    })
    expect(validateToolName("x".repeat(129))).toEqual({
      valid: false,
      reason: "length must be 1..128",
    })
  })
})

describe("collectInvalidToolNames", () => {
  it("returns invalid names with layer context", () => {
    const layers: ToolLayerMap = {
      "built-in": makeToolSet(["web_search"]),
      "third-party-search": makeToolSet(["invalid name"]),
      "content-extraction": makeToolSet(["extract_content"]),
      platform: makeToolSet(["ticket/status"]),
      mcp: makeToolSet(["my.server_tool"]),
    }

    const invalid = collectInvalidToolNames(layers)
    expect(invalid).toEqual([
      {
        toolKey: "invalid name",
        layer: "third-party-search",
        reason: "allowed characters are ASCII letters, digits, '_', '-', '.'",
      },
      {
        toolKey: "ticket/status",
        layer: "platform",
        reason: "allowed characters are ASCII letters, digits, '_', '-', '.'",
      },
    ])
  })
})

describe("collectGlobalCollisions", () => {
  it("detects collisions across all layers and reports the precedence winner", () => {
    const layers: ToolLayerMap = {
      "built-in": makeToolSet(["web_search", "shared_builtin_platform"]),
      "third-party-search": makeToolSet([
        "web_search",
        "shared_search_content",
      ]),
      "content-extraction": makeToolSet([
        "extract_content",
        "shared_search_content",
      ]),
      platform: makeToolSet(["read_ticket_status", "shared_builtin_platform"]),
      mcp: makeToolSet(["web_search", "read_ticket_status"]),
    }

    expect(collectGlobalCollisions(layers)).toEqual([
      {
        toolKey: "read_ticket_status",
        owners: ["platform", "mcp"],
        winner: "mcp",
      },
      {
        toolKey: "shared_builtin_platform",
        owners: ["built-in", "platform"],
        winner: "platform",
      },
      {
        toolKey: "shared_search_content",
        owners: ["third-party-search", "content-extraction"],
        winner: "content-extraction",
      },
      {
        toolKey: "web_search",
        owners: ["built-in", "third-party-search", "mcp"],
        winner: "mcp",
      },
    ])
  })

  it("returns empty array when there are no collisions", () => {
    const layers: ToolLayerMap = {
      "built-in": makeToolSet(["provider_search"]),
      "third-party-search": makeToolSet(["web_search"]),
      "content-extraction": makeToolSet(["extract_content"]),
      platform: makeToolSet(["create_ticket"]),
      mcp: makeToolSet(["github_list_issues"]),
    }

    expect(collectGlobalCollisions(layers)).toEqual([])
  })
})

describe("enforceToolNamingGovernance", () => {
  it("removes invalid names and drops only losing colliders", () => {
    const layers: ToolLayerMap = {
      "built-in": makeToolSet(["web_search", "shared"]),
      "third-party-search": makeToolSet(["invalid name", "shared"]),
      "content-extraction": makeToolSet(["extract_content"]),
      platform: makeToolSet(["create_ticket", "ticket/status"]),
      mcp: makeToolSet(["mcp.valid_tool"]),
    }

    const result = enforceToolNamingGovernance(layers)

    expect(result.invalid).toEqual([
      {
        toolKey: "invalid name",
        layer: "third-party-search",
        reason: "allowed characters are ASCII letters, digits, '_', '-', '.'",
      },
      {
        toolKey: "ticket/status",
        layer: "platform",
        reason: "allowed characters are ASCII letters, digits, '_', '-', '.'",
      },
    ])

    expect(result.collisions).toEqual([
      {
        toolKey: "shared",
        owners: ["built-in", "third-party-search"],
        winner: "third-party-search",
      },
    ])

    expect(result.sanitizedLayers["built-in"]).toEqual(
      makeToolSet(["web_search"])
    )
    expect(result.sanitizedLayers["third-party-search"]).toEqual(
      makeToolSet(["shared"])
    )
    expect(result.sanitizedLayers.platform).toEqual(
      makeToolSet(["create_ticket"])
    )
  })
})
