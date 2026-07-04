import type { ModelIdKind } from "./types"

type ModelIdAlias = {
  sourceId: string
  targetId: string
  idKind: Extract<ModelIdKind, "alias">
  verifiedAgainst?: string
  lastVerifiedAt?: string
}

type ModelIdSuccessor = {
  sourceId: string
  targetId: string
  replacementModelId: string
  verifiedAgainst?: string
  lastVerifiedAt?: string
}

const MODEL_ID_ALIASES = [
  {
    // Alias of a now-delisted id: resolveCompatibilityModelId chains this
    // through the `openrouter:deepseek/deepseek-r1:free` succession below.
    sourceId: "deepseek-r1",
    targetId: "openrouter:deepseek/deepseek-r1:free",
    idKind: "alias",
    verifiedAgainst: "openrouter:deepseek/deepseek-r1:free",
    lastVerifiedAt: "2026-03-08",
  },
  {
    sourceId: "codestral-latest",
    targetId: "codestral-2508",
    idKind: "alias",
    verifiedAgainst: "codestral-2508",
    lastVerifiedAt: "2026-03-08",
  },
  {
    sourceId: "ministral-3b-latest",
    targetId: "ministral-3b-2512",
    idKind: "alias",
    verifiedAgainst: "ministral-3b-2512",
    lastVerifiedAt: "2026-03-08",
  },
  {
    sourceId: "ministral-8b-latest",
    targetId: "ministral-8b-2512",
    idKind: "alias",
    verifiedAgainst: "ministral-8b-2512",
    lastVerifiedAt: "2026-03-08",
  },
  {
    sourceId: "mistral-large-latest",
    targetId: "mistral-large-2512",
    idKind: "alias",
    verifiedAgainst: "mistral-large-2512",
    lastVerifiedAt: "2026-03-08",
  },
  {
    sourceId: "mistral-small-latest",
    targetId: "mistral-small-2506",
    idKind: "alias",
    verifiedAgainst: "mistral-small-2506",
    lastVerifiedAt: "2026-03-08",
  },
  {
    sourceId: "pixtral-large-latest",
    targetId: "pixtral-large-2411",
    idKind: "alias",
    verifiedAgainst: "pixtral-large-2411",
    lastVerifiedAt: "2026-03-08",
  },
  {
    sourceId: "o4-mini",
    targetId: "gpt-5-mini",
    idKind: "alias",
    verifiedAgainst: "gpt-5-mini-2025-08-07",
    lastVerifiedAt: "2026-03-08",
  },
  {
    sourceId: "claude-sonnet-4-5",
    targetId: "claude-sonnet-4-5-20250929",
    idKind: "alias",
    verifiedAgainst: "claude-sonnet-4-5-20250929",
    lastVerifiedAt: "2026-03-08",
  },
  {
    sourceId: "claude-haiku-4-5",
    targetId: "claude-haiku-4-5-20251001",
    idKind: "alias",
    verifiedAgainst: "claude-haiku-4-5-20251001",
    lastVerifiedAt: "2026-03-08",
  },
] as const satisfies readonly ModelIdAlias[]

const MODEL_ID_SUCCESSIONS = [
  // Successions resolve in a single hop (no chaining), so every entry must
  // target a LIVE catalog id — when a target dies, repoint all entries that
  // reached it (see deepseek-v3 below, which previously targeted R1:free).
  {
    sourceId: "deepseek-v3",
    targetId: "openrouter:openai/gpt-oss-120b:free",
    replacementModelId: "openrouter:openai/gpt-oss-120b:free",
    verifiedAgainst: "openai/gpt-oss-120b:free",
    lastVerifiedAt: "2026-07-04",
  },
  {
    // OpenRouter delisted `deepseek/deepseek-r1:free` (no free R1 remains as
    // of 2026-07-04). GPT-OSS 120B is the free reasoning-model successor.
    sourceId: "openrouter:deepseek/deepseek-r1:free",
    targetId: "openrouter:openai/gpt-oss-120b:free",
    replacementModelId: "openrouter:openai/gpt-oss-120b:free",
    verifiedAgainst: "openai/gpt-oss-120b:free",
    lastVerifiedAt: "2026-07-04",
  },
  {
    // OpenRouter delisted `meta-llama/llama-3.3-8b-instruct:free` (the paid
    // variant is gone too); the 70B free endpoint is the same-family successor.
    sourceId: "openrouter:meta-llama/llama-3.3-8b-instruct:free",
    targetId: "openrouter:meta-llama/llama-3.3-70b-instruct:free",
    replacementModelId: "openrouter:meta-llama/llama-3.3-70b-instruct:free",
    verifiedAgainst: "meta-llama/llama-3.3-70b-instruct:free",
    lastVerifiedAt: "2026-07-04",
  },
  {
    sourceId: "mistral-small-2503",
    targetId: "mistral-small-2506",
    replacementModelId: "mistral-small-2506",
    verifiedAgainst: "mistral-small-2506",
    lastVerifiedAt: "2026-03-08",
  },
  {
    sourceId: "sonar-reasoning",
    targetId: "sonar-reasoning-pro",
    replacementModelId: "sonar-reasoning-pro",
    verifiedAgainst: "sonar-reasoning-pro",
    lastVerifiedAt: "2026-03-08",
  },
  {
    sourceId: "grok-4",
    targetId: "grok-4-0709",
    replacementModelId: "grok-4-0709",
    verifiedAgainst: "grok-4-0709",
    lastVerifiedAt: "2026-03-08",
  },
  {
    sourceId: "gpt-5.2",
    targetId: "gpt-5.4",
    replacementModelId: "gpt-5.4",
    verifiedAgainst: "gpt-5.4-2026-03-05",
    lastVerifiedAt: "2026-03-08",
  },
] as const satisfies readonly ModelIdSuccessor[]

const MODEL_ID_ALIAS_MAP = Object.fromEntries(
  MODEL_ID_ALIASES.map((entry) => [entry.sourceId, entry.targetId])
) as Record<string, string>

const MODEL_ID_SUCCESSOR_MAP = Object.fromEntries(
  MODEL_ID_SUCCESSIONS.map((entry) => [entry.sourceId, entry.targetId])
) as Record<string, string>

export function resolveLegacyAliasModelId(modelId: string): string {
  return MODEL_ID_ALIAS_MAP[modelId] ?? modelId
}

export function resolveCompatibilityModelId(modelId: string): string {
  const aliasResolvedModelId = resolveLegacyAliasModelId(modelId)
  return MODEL_ID_SUCCESSOR_MAP[aliasResolvedModelId] ?? aliasResolvedModelId
}

export function resolveModelId(modelId: string): string {
  return resolveCompatibilityModelId(modelId)
}

export function resolveModelIds(modelIds: readonly string[]): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const modelId of modelIds) {
    const resolved = resolveModelId(modelId)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    normalized.push(resolved)
  }

  return normalized
}
