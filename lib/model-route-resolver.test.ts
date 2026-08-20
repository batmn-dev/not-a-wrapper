import type { Provider } from "@/lib/provider-identity"
import { describe, expect, it } from "vitest"
import {
  resolveModelRoute,
  type ApiKeyPreference,
  type RouteResolverDeps,
} from "./model-route-resolver"

// Deterministic fixture deps: real catalog, injected keys and entitlement.
// "claude-sonnet-5" carries two routes (anthropic direct + openrouter);
// "gpt-5-mini" is free-listed; "openrouter:z-ai/glm-5.2" is OpenRouter-only.
function makeDeps({
  userKeys = {},
  platformKeys = ["openai", "mistral", "openrouter"],
  freeModels = ["gpt-5-mini"],
}: {
  userKeys?: Partial<Record<Provider, { key: string; preference: ApiKeyPreference }>>
  platformKeys?: Provider[]
  freeModels?: string[]
} = {}): RouteResolverDeps {
  return {
    getKeySettings: async () =>
      Object.entries(userKeys).map(([provider, entry]) => ({
        provider,
        preference: entry.preference,
      })),
    getUserKey: async (provider) => userKeys[provider]?.key ?? null,
    getPlatformKey: (provider) =>
      platformKeys.includes(provider) ? `platform-${provider}` : undefined,
    entitlement: {
      isRouteEligible: ({ modelId }) => freeModels.includes(modelId),
    },
  }
}

const authed = { isAuthenticated: true, token: "tok" } as const

describe("resolveModelRoute", () => {
  it("prefers priority BYOK over platform entitlement", async () => {
    const result = await resolveModelRoute(
      { modelId: "gpt-5-mini", ...authed },
      makeDeps({
        userKeys: { openai: { key: "sk-user", preference: "priority" } },
      })
    )
    expect(result).toMatchObject({
      ok: true,
      apiKey: "sk-user",
      route: {
        routeId: "gpt-5-mini",
        providerId: "openai",
        credentialSource: "byok",
        routeReason: "priority_byok",
      },
    })
  })

  it("prefers platform entitlement over fallback BYOK", async () => {
    const result = await resolveModelRoute(
      { modelId: "gpt-5-mini", ...authed },
      makeDeps({
        userKeys: { openai: { key: "sk-user", preference: "fallback" } },
      })
    )
    expect(result).toMatchObject({
      ok: true,
      apiKey: "platform-openai",
      route: { credentialSource: "platform", routeReason: "platform" },
    })
  })

  it("uses fallback BYOK when the platform is ineligible", async () => {
    const result = await resolveModelRoute(
      { modelId: "gpt-5.4", ...authed },
      makeDeps({
        userKeys: { openai: { key: "sk-user", preference: "fallback" } },
      })
    )
    expect(result).toMatchObject({
      ok: true,
      apiKey: "sk-user",
      route: { credentialSource: "byok", routeReason: "fallback_byok" },
    })
  })

  it("breaks ties toward the direct provider when both keys exist", async () => {
    const result = await resolveModelRoute(
      { modelId: "claude-sonnet-5", ...authed },
      makeDeps({
        userKeys: {
          anthropic: { key: "sk-ant", preference: "priority" },
          openrouter: { key: "sk-or", preference: "priority" },
        },
      })
    )
    expect(result).toMatchObject({
      ok: true,
      apiKey: "sk-ant",
      route: { routeId: "claude-sonnet-5", providerId: "anthropic" },
    })
  })

  it("reaches the same model through OpenRouter when only that key exists", async () => {
    const result = await resolveModelRoute(
      { modelId: "claude-sonnet-5", ...authed },
      makeDeps({
        userKeys: { openrouter: { key: "sk-or", preference: "priority" } },
      })
    )
    expect(result).toMatchObject({
      ok: true,
      apiKey: "sk-or",
      route: {
        routeId: "openrouter:anthropic/claude-sonnet-5",
        providerId: "openrouter",
        upstreamModelId: "anthropic/claude-sonnet-5",
        routeReason: "priority_byok",
      },
    })
  })

  it("honors a legacy route hint within the winning tier", async () => {
    const result = await resolveModelRoute(
      { modelId: "openrouter:anthropic/claude-sonnet-5", ...authed },
      makeDeps({
        userKeys: {
          anthropic: { key: "sk-ant", preference: "priority" },
          openrouter: { key: "sk-or", preference: "priority" },
        },
      })
    )
    expect(result).toMatchObject({
      ok: true,
      apiKey: "sk-or",
      route: {
        modelId: "claude-sonnet-5",
        routeId: "openrouter:anthropic/claude-sonnet-5",
        routeReason: "legacy_route_hint",
      },
    })
  })

  it("fails with the applicable key providers when no route is usable", async () => {
    const result = await resolveModelRoute(
      { modelId: "claude-sonnet-5", ...authed },
      makeDeps()
    )
    expect(result).toEqual({
      ok: false,
      reason: "no_eligible_route",
      modelId: "claude-sonnet-5",
      keyProviders: ["anthropic", "openrouter"],
    })
  })

  it("skips a stored key the server cannot actually resolve", async () => {
    // Key settings claim an anthropic key, but decryption yields nothing
    // (stale ciphertext): the resolver falls through to the next candidate.
    const deps = makeDeps({
      userKeys: { openrouter: { key: "sk-or", preference: "priority" } },
    })
    const result = await resolveModelRoute(
      { modelId: "claude-sonnet-5", ...authed },
      {
        ...deps,
        getKeySettings: async () => [
          { provider: "anthropic", preference: "priority" },
          { provider: "openrouter", preference: "priority" },
        ],
      }
    )
    expect(result).toMatchObject({
      ok: true,
      apiKey: "sk-or",
      route: { providerId: "openrouter" },
    })
  })

  it("filters candidates by required capabilities before preference order", async () => {
    // GLM 5.2 via OpenRouter has no vision; a key alone must not select it.
    const result = await resolveModelRoute(
      {
        modelId: "openrouter:z-ai/glm-5.2",
        ...authed,
        requiredCapabilities: { vision: true },
      },
      makeDeps({
        userKeys: { openrouter: { key: "sk-or", preference: "priority" } },
      })
    )
    expect(result).toEqual({
      ok: false,
      reason: "no_eligible_route",
      modelId: "openrouter:z-ai/glm-5.2",
      keyProviders: [],
    })
  })

  it("pins approval continuations to the paused provider", async () => {
    const result = await resolveModelRoute(
      { modelId: "claude-sonnet-5", ...authed, pinnedProviderId: "openrouter" },
      makeDeps({
        userKeys: {
          anthropic: { key: "sk-ant", preference: "priority" },
          openrouter: { key: "sk-or", preference: "priority" },
        },
      })
    )
    expect(result).toMatchObject({
      ok: true,
      route: { providerId: "openrouter" },
    })
  })

  it("serves anonymous turns only from platform-entitled routes", async () => {
    const allowed = await resolveModelRoute(
      { modelId: "gpt-5-mini", isAuthenticated: false },
      makeDeps({ freeModels: ["gpt-5-mini"] })
    )
    expect(allowed).toMatchObject({
      ok: true,
      route: { credentialSource: "platform", routeReason: "platform" },
    })

    const denied = await resolveModelRoute(
      { modelId: "claude-sonnet-5", isAuthenticated: false },
      makeDeps()
    )
    expect(denied).toMatchObject({ ok: false, reason: "auth_required" })
  })

  it("reports unknown models without leaking anything", async () => {
    const result = await resolveModelRoute(
      { modelId: "mystery-model", ...authed },
      makeDeps()
    )
    expect(result).toEqual({
      ok: false,
      reason: "model_not_found",
      modelId: "mystery-model",
      keyProviders: [],
    })
  })

  it("never returns key material on failures", async () => {
    const result = await resolveModelRoute(
      { modelId: "claude-sonnet-5", ...authed },
      makeDeps({
        userKeys: { google: { key: "sk-google", preference: "priority" } },
      })
    )
    expect(JSON.stringify(result)).not.toContain("sk-")
  })
})
