import { describe, expect, it } from "vitest"
import {
  AFFORDABILITY_RETRY_GENERATION_BUDGET,
  PLATFORM_RESPONSE_OUTPUT_TOKENS,
  resolveGenerationBudget,
  type GenerationBudgetRouteFacts,
} from "./output-budget"

const openRouter: GenerationBudgetRouteFacts = {
  providerId: "openrouter",
  maxOutput: 65_536,
}

const fixedAnthropic: GenerationBudgetRouteFacts = {
  providerId: "anthropic",
  reasoningText: true,
  thinkingMode: "enabled",
  thinkingBudget: 10_000,
  maxOutput: 64_000,
}

describe("resolveGenerationBudget", () => {
  it("leaves BYOK Auto unspecified", () => {
    expect(
      resolveGenerationBudget({
        route: openRouter,
        credentialSource: "byok",
        searchToolsActive: false,
      })
    ).toEqual({ ok: true })
  })

  it("applies an explicit budget equally to BYOK", () => {
    expect(
      resolveGenerationBudget({
        route: openRouter,
        credentialSource: "byok",
        requestedGenerationBudget: AFFORDABILITY_RETRY_GENERATION_BUDGET,
        searchToolsActive: false,
      })
    ).toEqual({
      ok: true,
      requestedGenerationBudget: 16_384,
      appliedGenerationBudget: 16_384,
      providerMaxOutputTokens: 16_384,
    })
  })

  it("keeps platform funding separate from credential ownership", () => {
    expect(
      resolveGenerationBudget({
        route: openRouter,
        credentialSource: "platform",
        requestedGenerationBudget: 32_768,
        searchToolsActive: false,
      })
    ).toEqual({
      ok: true,
      requestedGenerationBudget: 32_768,
      appliedGenerationBudget: PLATFORM_RESPONSE_OUTPUT_TOKENS,
      providerMaxOutputTokens: PLATFORM_RESPONSE_OUTPUT_TOKENS,
      platformOutputTokenReservation: PLATFORM_RESPONSE_OUTPUT_TOKENS,
    })
  })

  it("does not pass fixed Anthropic reasoning headroom to the SDK twice", () => {
    expect(
      resolveGenerationBudget({
        route: fixedAnthropic,
        credentialSource: "platform",
        searchToolsActive: false,
      })
    ).toEqual({
      ok: true,
      appliedGenerationBudget: 18_192,
      providerMaxOutputTokens: 8_192,
      platformOutputTokenReservation: 18_192,
    })
  })

  it("rejects an explicit total budget that cannot fit fixed reasoning", () => {
    expect(
      resolveGenerationBudget({
        route: fixedAnthropic,
        credentialSource: "byok",
        requestedGenerationBudget: 8_192,
        searchToolsActive: false,
      })
    ).toEqual({ ok: false, minimumGenerationBudget: 10_001 })
  })
})
