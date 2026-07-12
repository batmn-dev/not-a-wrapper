import type { OpenRouterAllowlistEntry } from "@/lib/models/data/openrouter.allowlist"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  buildCatalog,
  fetchLiveListing,
  MissingAllowlistedIdsError,
  pricePerMillionTokens,
  type OpenRouterSnapshot,
  type OpenRouterSnapshotModel,
} from "./generate-openrouter-catalog"

afterEach(() => {
  vi.unstubAllGlobals()
})

function snapshotModel(
  overrides: Partial<OpenRouterSnapshotModel> & { id: string }
): OpenRouterSnapshotModel {
  return {
    name: overrides.id,
    created: 1751500800, // 2025-07-03
    context_length: 131072,
    top_provider: { max_completion_tokens: 8192 },
    pricing: { prompt: "0.000002", completion: "0.00001" },
    supported_parameters: ["tools"],
    architecture: { input_modalities: ["text"] },
    ...overrides,
  }
}

function allowlistEntry(
  overrides: Partial<OpenRouterAllowlistEntry> & { slug: string }
): OpenRouterAllowlistEntry {
  return {
    name: overrides.slug,
    description: "test entry",
    tags: ["test"],
    modelFamily: "Test",
    baseProviderId: "testvendor",
    icon: "openrouter",
    speed: "Fast",
    intelligence: "Medium",
    openSource: false,
    ...overrides,
  }
}

describe("generate-openrouter-catalog invariants", () => {
  it("derives ModelConfig fields from the snapshot and allowlist", () => {
    const snapshot: OpenRouterSnapshot = {
      endpoint: "https://openrouter.ai/api/v1/models",
      retrievedAt: "2026-07-05",
      models: [
        snapshotModel({
          id: "vendor/reasoner",
          supported_parameters: ["reasoning", "tools"],
          architecture: { input_modalities: ["text", "image", "audio"] },
          pricing: { prompt: "0.000000574", completion: "0.000001804" },
        }),
        snapshotModel({
          id: "vendor/plain",
          top_provider: { max_completion_tokens: null },
        }),
      ],
    }
    const allowlist = [
      allowlistEntry({ slug: "vendor/reasoner" }),
      allowlistEntry({ slug: "vendor/plain" }),
    ]

    const [reasoner, plain] = buildCatalog(snapshot, allowlist)

    // Reasoning derivation ON: live `reasoning` param → capability flag +
    // construction-time config (the OpenRouter V4 provider expects it there).
    expect(reasoner).toMatchObject({
      id: "openrouter:vendor/reasoner",
      providerId: "openrouter",
      idKind: "wrapped",
      verifiedAgainst: "vendor/reasoner",
      lastVerifiedAt: "2026-07-05",
      reasoningText: true,
      reasoning: { effort: "medium" },
      vision: true,
      tools: true,
      audio: true,
      webSearch: false,
      apiDocs: "https://openrouter.ai/vendor/reasoner",
    })
    // Textual decimal shift — no IEEE 754 dust in generated prices.
    expect(reasoner?.inputCost).toBe(0.574)
    expect(reasoner?.outputCost).toBe(1.804)

    // Reasoning derivation OFF: no live param → no config, flag false.
    expect(plain?.reasoningText).toBe(false)
    expect(plain?.reasoning).toBeUndefined()
    expect(plain?.vision).toBe(false)
    expect(plain?.audio).toBe(false)
    expect(plain?.webSearch).toBe(false)
    // Null max_completion_tokens → field omitted entirely.
    expect(plain && "maxOutput" in plain).toBe(false)
    // releasedAt derives from the snapshot `created` timestamp.
    expect(plain?.releasedAt).toBe("2025-07-03")
  })

  it("fails loudly with a succession stub when an allowlisted id is missing", () => {
    const snapshot: OpenRouterSnapshot = {
      endpoint: "https://openrouter.ai/api/v1/models",
      retrievedAt: "2026-07-05",
      models: [snapshotModel({ id: "vendor/alive" })],
    }
    const allowlist = [
      allowlistEntry({ slug: "vendor/alive" }),
      allowlistEntry({ slug: "vendor/delisted" }),
    ]

    expect(() => buildCatalog(snapshot, allowlist)).toThrowError(
      MissingAllowlistedIdsError
    )
    expect(() => buildCatalog(snapshot, allowlist)).toThrowError(
      /sourceId: "openrouter:vendor\/delisted"/
    )
  })

  it("shifts per-token price strings without float artifacts", () => {
    expect(pricePerMillionTokens("0")).toBe(0)
    expect(pricePerMillionTokens("0.000002")).toBe(2)
    expect(pricePerMillionTokens("0.00000001")).toBe(0.01)
    expect(pricePerMillionTokens("0.0000015")).toBe(1.5)
  })

  it("fails explicitly when the live listing JSON shape changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: null })))
    )

    await expect(fetchLiveListing()).rejects.toThrowError(
      "https://openrouter.ai/api/v1/models returned an unexpected JSON shape"
    )
  })
})
