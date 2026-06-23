import { describe, expect, it } from "vitest"
import type { ToolInvocationStreamMetadata } from "@/lib/tools/ui-metadata"
import {
  type PersistedMessageMetadata,
  projectPersistedMessageMetadata,
} from "./messageMetadata"

// Type-level drift guard: the persisted-metadata validator and the client
// stream-metadata type must stay structurally identical. These assignments fail
// compilation the moment either side gains, loses, or retypes a key.
const _toPersisted: PersistedMessageMetadata = {} as ToolInvocationStreamMetadata
const _toClient: ToolInvocationStreamMetadata = {} as PersistedMessageMetadata
void _toPersisted
void _toClient

const display = {
  displayName: "Web Search",
  source: "builtin" as const,
  serviceName: "openai",
  icon: "search" as const,
  estimatedCostPer1k: 5,
  readOnly: true,
}

describe("projectPersistedMessageMetadata", () => {
  it("returns undefined for an empty, missing, or non-record blob", () => {
    expect(projectPersistedMessageMetadata(undefined)).toBeUndefined()
    expect(projectPersistedMessageMetadata({})).toBeUndefined()
    expect(projectPersistedMessageMetadata("nope")).toBeUndefined()
    expect(projectPersistedMessageMetadata([1, 2])).toBeUndefined()
  })

  it("keeps the known stream keys", () => {
    const result = projectPersistedMessageMetadata({
      reasoningDurationMs: 1200,
      toolMetadataByName: { web_search: display },
      toolMetadataByCallId: { call_1: display },
    })
    expect(result).toEqual({
      reasoningDurationMs: 1200,
      toolMetadataByName: { web_search: display },
      toolMetadataByCallId: { call_1: display },
    })
  })

  it("drops unknown top-level keys the SDK might attach", () => {
    const result = projectPersistedMessageMetadata({
      reasoningDurationMs: 1,
      sdkInternal: { secret: true },
    })
    expect(result).toEqual({ reasoningDurationMs: 1 })
  })

  it("drops a display entry with an unknown tool source", () => {
    const result = projectPersistedMessageMetadata({
      toolMetadataByName: {
        good: display,
        bad: { ...display, source: "rogue" },
      },
    })
    expect(result?.toolMetadataByName).toEqual({ good: display })
  })

  it("omits an invalid icon but keeps the entry", () => {
    const result = projectPersistedMessageMetadata({
      toolMetadataByName: { t: { ...display, icon: "spaceship" } },
    })
    expect(result?.toolMetadataByName?.t).toEqual({
      displayName: "Web Search",
      source: "builtin",
      serviceName: "openai",
      estimatedCostPer1k: 5,
      readOnly: true,
    })
  })

  it("returns undefined when every display entry is invalid", () => {
    const result = projectPersistedMessageMetadata({
      toolMetadataByName: { bad: { displayName: 5 } },
    })
    expect(result).toBeUndefined()
  })
})
