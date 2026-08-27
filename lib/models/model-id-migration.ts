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
    sourceId: "gpt-5.6",
    targetId: "gpt-5.6-sol",
    idKind: "alias",
    verifiedAgainst: "gpt-5.6-sol",
    lastVerifiedAt: "2026-08-20",
  },
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
    sourceId: "ministral-14b-latest",
    targetId: "ministral-14b-2512",
    idKind: "alias",
    verifiedAgainst: "ministral-14b-2512",
    lastVerifiedAt: "2026-08-20",
  },
  {
    // AI SDK 4.0.8 suggests a dotted id, while Mistral's public API uses
    // the lifecycle-standard hyphenated major/minor identifier.
    sourceId: "mistral-medium-3.5",
    targetId: "mistral-medium-3-5",
    idKind: "alias",
    verifiedAgainst: "mistral-medium-3-5",
    lastVerifiedAt: "2026-08-20",
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
    targetId: "mistral-small-2603",
    idKind: "alias",
    verifiedAgainst: "mistral-small-2603",
    lastVerifiedAt: "2026-08-20",
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
    targetId: "openrouter:openai/gpt-oss-120b",
    replacementModelId: "openrouter:openai/gpt-oss-120b",
    verifiedAgainst: "openai/gpt-oss-120b",
    lastVerifiedAt: "2026-08-20",
  },
  {
    // OpenRouter delisted `deepseek/deepseek-r1:free` (no free R1 remains as
    // of 2026-07-04). GPT-OSS 120B is the live reasoning-model successor.
    sourceId: "openrouter:deepseek/deepseek-r1:free",
    targetId: "openrouter:openai/gpt-oss-120b",
    replacementModelId: "openrouter:openai/gpt-oss-120b",
    verifiedAgainst: "openai/gpt-oss-120b",
    lastVerifiedAt: "2026-08-20",
  },
  {
    // OpenRouter delisted `meta-llama/llama-3.3-8b-instruct:free` (the paid
    // variant is gone too); the paid 70B endpoint is the same-family successor.
    sourceId: "openrouter:meta-llama/llama-3.3-8b-instruct:free",
    targetId: "openrouter:meta-llama/llama-3.3-70b-instruct",
    replacementModelId: "openrouter:meta-llama/llama-3.3-70b-instruct",
    verifiedAgainst: "meta-llama/llama-3.3-70b-instruct",
    lastVerifiedAt: "2026-08-20",
  },
  {
    sourceId: "openrouter:openai/gpt-oss-120b:free",
    targetId: "openrouter:openai/gpt-oss-120b",
    replacementModelId: "openrouter:openai/gpt-oss-120b",
    verifiedAgainst: "openai/gpt-oss-120b",
    lastVerifiedAt: "2026-08-20",
  },
  {
    sourceId: "openrouter:meta-llama/llama-3.3-70b-instruct:free",
    targetId: "openrouter:meta-llama/llama-3.3-70b-instruct",
    replacementModelId: "openrouter:meta-llama/llama-3.3-70b-instruct",
    verifiedAgainst: "meta-llama/llama-3.3-70b-instruct",
    lastVerifiedAt: "2026-08-20",
  },
  {
    sourceId: "openrouter:qwen/qwen3-coder:free",
    targetId: "openrouter:qwen/qwen3-coder",
    replacementModelId: "openrouter:qwen/qwen3-coder",
    verifiedAgainst: "qwen/qwen3-coder",
    lastVerifiedAt: "2026-08-20",
  },
  {
    sourceId: "openrouter:xiaomi/mimo-v2-flash",
    targetId: "openrouter:xiaomi/mimo-v2.5",
    replacementModelId: "openrouter:xiaomi/mimo-v2.5",
    verifiedAgainst: "xiaomi/mimo-v2.5",
    lastVerifiedAt: "2026-08-20",
  },
  {
    sourceId: "openrouter:inclusionai/ling-2.6-flash",
    targetId: "openrouter:inclusionai/ling-3.0-flash",
    replacementModelId: "openrouter:inclusionai/ling-3.0-flash",
    verifiedAgainst: "inclusionai/ling-3.0-flash",
    lastVerifiedAt: "2026-08-25",
  },
  {
    // OpenRouter delisted the cloaked `stealth/ox-alpha` test model. Its
    // reveal is unconfirmed; qwen3.8-max is the nearest live allowlisted
    // equivalent (closed, Medium/High, text+image+video, 131k max output,
    // ~1M context).
    sourceId: "openrouter:stealth/ox-alpha",
    targetId: "openrouter:qwen/qwen3.8-max",
    replacementModelId: "openrouter:qwen/qwen3.8-max",
    verifiedAgainst: "qwen/qwen3.8-max",
    lastVerifiedAt: "2026-08-27",
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
