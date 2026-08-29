import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { Provider } from "@/lib/provider-identity"
import { fetchMutation } from "convex/nextjs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  reserveAuthorizedPlatformUsage,
  resolveModelRoute,
  type ApiKeyPreference,
  type PlatformFundingContext,
  type ReservePlatformUsageArgs,
  type RouteResolverDeps,
} from "./model-route-resolver"

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(),
}))

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
  userKeys?: Partial<
    Record<Provider, { key: string; preference: ApiKeyPreference }>
  >
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
  workosUserId: "workos-user-1",
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

const authorizedReserveArgs: ReservePlatformUsageArgs = {
  token: "tok",
  workosUserId: "workos-user-1",
  requestId: "req-1",
  chatId: "chat-1",
  modelId: "gpt-5-mini",
  routeId: "gpt-5-mini",
  providerId: "openai",
  estimatedCredits: 100,
  estimatedInputTokens: 10,
  estimatedOutputTokens: 20,
  titleEstimatedCredits: 5,
  titleEstimatedInputTokens: 4,
  pricingSnapshot: {
    revision: "catalog-v1",
    currency: "USD",
    primary: {
      modelId: "gpt-5-mini",
      routeId: "gpt-5-mini",
      providerId: "openai",
      upstreamModelId: "gpt-5-mini",
      inputCreditsPerMTok: 250_000,
      outputCreditsPerMTok: 2_000_000,
    },
  },
}

describe("authorized usage reservation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv(
      "CHAT_ADMISSION_SECRET",
      "test-chat-admission-secret-with-at-least-32-bytes"
    )
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://preview-one.convex.cloud")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("sends a signed authorization proof to the reservation mutation", async () => {
    vi.mocked(fetchMutation).mockResolvedValueOnce({
      kind: "reserved",
      reservationId: RESERVATION_ID,
    } as never)

    await expect(
      reserveAuthorizedPlatformUsage(authorizedReserveArgs)
    ).resolves.toEqual({
      kind: "reserved",
      reservationId: RESERVATION_ID,
    })

    expect(fetchMutation).toHaveBeenCalledWith(
      api.usageAllowance.reserveAuthorized,
      expect.objectContaining({
        requestId: "req-1",
        authorizationIssuedAt: expect.any(Number),
        authorizationProof: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
      { token: "tok" }
    )
    expect(fetchMutation).toHaveBeenCalledTimes(1)
  })

  it("never downgrades an authorization or runtime failure", async () => {
    const authorizationError = new Error(
      "Invalid usage reservation authorization"
    )
    vi.mocked(fetchMutation).mockRejectedValueOnce(authorizationError)

    await expect(
      reserveAuthorizedPlatformUsage(authorizedReserveArgs)
    ).rejects.toBe(authorizationError)
    expect(fetchMutation).toHaveBeenCalledTimes(1)
    expect(fetchMutation).toHaveBeenCalledWith(
      api.usageAllowance.reserveAuthorized,
      expect.any(Object),
      { token: "tok" }
    )
  })
})

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

  it("steers to the route serving the requested effort level (ADR-0026)", async () => {
    // gemini-2.5-pro: the direct google route has no effort knob (numeric
    // budgets), only its OpenRouter wrap serves levels. With keys for both,
    // the effort preference must beat the direct-before-aggregator ordering.
    const deps = makeDeps({
      userKeys: {
        google: { key: "sk-goog", preference: "priority" },
        openrouter: { key: "sk-or", preference: "priority" },
      },
    })
    const result = await resolveModelRoute(
      {
        modelId: "gemini-2.5-pro",
        ...authed,
        requiredCapabilities: { webSearch: false, reasoningEffort: "xhigh" },
      },
      deps
    )
    expect(result).toMatchObject({
      ok: true,
      route: { providerId: "openrouter" },
    })
  })

  it("keeps the effort preference soft when no preferred route has a credential (ADR-0026)", async () => {
    // Only the OpenRouter wrap of gemini-2.5-pro serves effort levels, but
    // this user holds only a google key (and no platform tier applies). The
    // preference must not turn a servable turn into no_eligible_route —
    // resolution re-runs unconstrained and the turn runs at Default.
    const deps = makeDeps({
      platformKeys: [],
      userKeys: { google: { key: "sk-goog", preference: "priority" } },
    })
    const result = await resolveModelRoute(
      {
        modelId: "gemini-2.5-pro",
        ...authed,
        requiredCapabilities: { webSearch: false, reasoningEffort: "xhigh" },
      },
      deps
    )
    expect(result).toMatchObject({
      ok: true,
      apiKey: "sk-goog",
      route: { providerId: "google" },
    })
  })

  it("keeps the effort preference soft under a provider pin (ADR-0026)", async () => {
    // A continuation pinned to anthropic excludes every xhigh-capable route;
    // resolution must fall back to the pinned route (shaping clamps) rather
    // than fail the turn with no_eligible_route.
    const deps = makeDeps({
      userKeys: { anthropic: { key: "sk-ant", preference: "priority" } },
    })
    const result = await resolveModelRoute(
      {
        modelId: "claude-sonnet-4-6",
        ...authed,
        pinnedProviderId: "anthropic",
        requiredCapabilities: { webSearch: false, reasoningEffort: "xhigh" },
      },
      deps
    )
    expect(result).toMatchObject({
      ok: true,
      route: { providerId: "anthropic", routeId: "claude-sonnet-4-6" },
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
      workosUserId: "workos-user-1",
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

  it("lets an explicit smaller generation budget lower the platform reservation", async () => {
    const deps = makeDeps()
    const result = await resolveModelRoute(
      {
        modelId: "gpt-5-mini",
        ...authed,
        platformFunding: { ...funding, generationBudget: 4_096 },
      },
      deps
    )

    expect(result).toMatchObject({
      ok: true,
      route: { credentialSource: "platform" },
    })
    expect(deps.reserveCalls[0]?.estimatedOutputTokens).toBe(4_096)
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
    expect(deps.reserveCalls.map((call) => call.providerId)).toEqual([
      "openai",
      "openrouter",
    ])
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
      keyProviders: ["openai", "openrouter"],
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
    // GLM-5.2 via OpenRouter has no vision; a key alone must not select it.
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

  it("rejects routes that explicitly opt out when web search is required", async () => {
    const result = await resolveModelRoute(
      {
        modelId: "gemma-3-27b-it",
        ...authed,
        requiredCapabilities: { webSearch: true },
      },
      makeDeps({
        userKeys: { google: { key: "sk-google", preference: "priority" } },
      })
    )

    expect(result).toEqual({
      ok: false,
      reason: "no_eligible_route",
      modelId: "gemma-3-27b-it",
      keyProviders: [],
    })
  })

  it("requires inherent-search routes to stay enabled", async () => {
    const deps = makeDeps({
      userKeys: {
        perplexity: { key: "sk-perplexity", preference: "priority" },
      },
    })
    const enabled = await resolveModelRoute(
      {
        modelId: "sonar",
        ...authed,
        requiredCapabilities: { webSearch: true },
      },
      deps
    )
    const disabled = await resolveModelRoute(
      {
        modelId: "sonar",
        ...authed,
        requiredCapabilities: { webSearch: false },
      },
      deps
    )

    expect(enabled).toMatchObject({
      ok: true,
      route: { providerId: "perplexity" },
    })
    expect(disabled).toEqual({
      ok: false,
      reason: "no_eligible_route",
      modelId: "sonar",
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
