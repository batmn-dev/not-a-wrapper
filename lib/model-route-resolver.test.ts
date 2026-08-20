import type { Id } from "@/convex/_generated/dataModel"
import type { Provider } from "@/lib/provider-identity"
import { describe, expect, it } from "vitest"
import {
  resolveModelRoute,
  type ApiKeyPreference,
  type PlatformFundingContext,
  type ReservePlatformUsageArgs,
  type RouteResolverDeps,
} from "./model-route-resolver"

const RESERVATION_ID = "res-1" as Id<"usageReservations">

type ReserveBehavior = (
  args: ReservePlatformUsageArgs
) => Awaited<ReturnType<RouteResolverDeps["reservePlatformUsage"]>>

// Deterministic fixture deps: real catalog, injected keys and entitlement.
// "claude-sonnet-5" carries two routes (anthropic direct + openrouter);
// "gpt-5-mini" is free-listed; "openrouter:z-ai/glm-5.2" is OpenRouter-only.
function makeDeps({
  userKeys = {},
  platformKeys = ["openai", "mistral", "openrouter"],
  freeModels = ["gpt-5-mini"],
  reserve = () => ({ kind: "reserved", reservationId: RESERVATION_ID }),
}: {
  userKeys?: Partial<Record<Provider, { key: string; preference: ApiKeyPreference }>>
  platformKeys?: Provider[]
  freeModels?: string[]
  reserve?: ReserveBehavior
} = {}): RouteResolverDeps & { reserveCalls: ReservePlatformUsageArgs[] } {
  const reserveCalls: ReservePlatformUsageArgs[] = []
  return {
    reserveCalls,
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
    reservePlatformUsage: async (args) => {
      reserveCalls.push(args)
      return reserve(args)
    },
  }
}

const funding: PlatformFundingContext = {
  requestId: "req-1",
  chatId: "chat-1",
  messages: [
    { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] },
  ] as PlatformFundingContext["messages"],
  toolsLikely: false,
}

const authed = {
  isAuthenticated: true,
  token: "tok",
  platformFunding: funding,
} as const

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

  it("prefers platform entitlement over fallback BYOK and reserves allowance", async () => {
    const deps = makeDeps({
      userKeys: { openai: { key: "sk-user", preference: "fallback" } },
    })
    const result = await resolveModelRoute(
      { modelId: "gpt-5-mini", ...authed },
      deps
    )
    expect(result).toMatchObject({
      ok: true,
      apiKey: "platform-openai",
      reservationId: RESERVATION_ID,
      route: { credentialSource: "platform", routeReason: "platform" },
    })
    expect(deps.reserveCalls).toHaveLength(1)
    expect(deps.reserveCalls[0]).toMatchObject({
      requestId: "req-1",
      chatId: "chat-1",
      modelId: "gpt-5-mini",
      routeId: "gpt-5-mini",
      providerId: "openai",
    })
    expect(deps.reserveCalls[0]!.estimatedCredits).toBeGreaterThan(0)
    expect(deps.reserveCalls[0]!.pricingSnapshot.primary.routeId).toBe(
      "gpt-5-mini"
    )
  })

  it("priority BYOK bypasses platform reservation entirely", async () => {
    const deps = makeDeps({
      userKeys: { openai: { key: "sk-user", preference: "priority" } },
    })
    const result = await resolveModelRoute(
      { modelId: "gpt-5-mini", ...authed },
      deps
    )
    expect(result).toMatchObject({
      ok: true,
      apiKey: "sk-user",
      route: { credentialSource: "byok", routeReason: "priority_byok" },
    })
    expect(deps.reserveCalls).toHaveLength(0)
    expect(
      (result as { reservationId?: unknown }).reservationId
    ).toBeUndefined()
  })

  it("falls through to fallback BYOK when allowance is insufficient", async () => {
    const deps = makeDeps({
      userKeys: { openai: { key: "sk-user", preference: "fallback" } },
      reserve: () => ({
        kind: "insufficient_allowance",
        availableCredits: 0,
        requiredCredits: 100,
      }),
    })
    const result = await resolveModelRoute(
      { modelId: "gpt-5-mini", ...authed },
      deps
    )
    expect(result).toMatchObject({
      ok: true,
      apiKey: "sk-user",
      route: { credentialSource: "byok", routeReason: "fallback_byok" },
    })
    expect(deps.reserveCalls).toHaveLength(1)
  })

  it("fails typed insufficient_allowance when no BYOK route can serve", async () => {
    const deps = makeDeps({
      reserve: () => ({
        kind: "insufficient_allowance",
        availableCredits: 0,
        requiredCredits: 100,
      }),
    })
    const result = await resolveModelRoute(
      { modelId: "gpt-5-mini", ...authed },
      deps
    )
    expect(result).toMatchObject({
      ok: false,
      reason: "insufficient_allowance",
      keyProviders: ["openai"],
    })
  })

  it("tries a later platform candidate after a failed reservation", async () => {
    // Both claude-sonnet-5 routes are platform-listed; the direct anthropic
    // route's reservation is denied, the (cheaper) OpenRouter route lands.
    const deps = makeDeps({
      platformKeys: ["anthropic", "openrouter"],
      freeModels: ["claude-sonnet-5"],
      reserve: (args) =>
        args.providerId === "anthropic"
          ? {
              kind: "insufficient_allowance",
              availableCredits: 10,
              requiredCredits: 100,
            }
          : { kind: "reserved", reservationId: RESERVATION_ID },
    })
    const result = await resolveModelRoute(
      { modelId: "claude-sonnet-5", ...authed },
      deps
    )
    expect(result).toMatchObject({
      ok: true,
      reservationId: RESERVATION_ID,
      route: {
        providerId: "openrouter",
        routeId: "openrouter:anthropic/claude-sonnet-5",
        credentialSource: "platform",
      },
    })
    expect(deps.reserveCalls.map((call) => call.providerId)).toEqual([
      "anthropic",
      "openrouter",
    ])
  })

  it("treats an idempotent reservation replay as admission", async () => {
    const deps = makeDeps({
      reserve: () => ({
        kind: "idempotent_replay",
        reservationId: RESERVATION_ID,
      }),
    })
    const result = await resolveModelRoute(
      { modelId: "gpt-5-mini", ...authed },
      deps
    )
    expect(result).toMatchObject({
      ok: true,
      reservationId: RESERVATION_ID,
      route: { credentialSource: "platform" },
    })
  })

  it("skips the platform tier when no funding context exists", async () => {
    // Authenticated turn against a non-durable chat: reservation/settlement
    // are impossible, so platform candidates are ineligible (ADR-0021).
    const deps = makeDeps({
      userKeys: { openai: { key: "sk-user", preference: "fallback" } },
    })
    const result = await resolveModelRoute(
      { modelId: "gpt-5-mini", isAuthenticated: true, token: "tok" },
      deps
    )
    expect(result).toMatchObject({
      ok: true,
      apiKey: "sk-user",
      route: { credentialSource: "byok", routeReason: "fallback_byok" },
    })
    expect(deps.reserveCalls).toHaveLength(0)
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
