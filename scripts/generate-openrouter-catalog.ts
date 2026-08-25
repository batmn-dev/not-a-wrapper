#!/usr/bin/env bun
/**
 * OpenRouter catalog generator (ADR 0007 — snapshot-generated catalog).
 *
 * Joins the committed snapshot (`lib/models/data/openrouter.snapshot.json`,
 * the machine half: pricing, context, capability parameters, listing
 * existence) with the curated allowlist
 * (`lib/models/data/openrouter.allowlist.ts`, the editorial half) and emits
 * `lib/models/data/openrouter.generated.ts`. The generated file is never
 * hand-edited — CI runs `--check` to enforce that.
 *
 * Modes:
 *   bun run catalog:openrouter          — regenerate from committed files
 *   bun run catalog:openrouter:refresh  — (--fetch) refresh the snapshot from
 *                                         the live listing first, then generate
 *   bun run catalog:openrouter:check    — (--check) offline + deterministic:
 *                                         regenerate and fail on any diff
 *
 * Generation fails loudly when an allowlisted id is absent from the snapshot
 * (the 2026-07-04 delisting incident class) and prints a ready-to-paste
 * succession stub for lib/models/model-id-migration.ts.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { directModels } from "@/lib/models/data/direct"
import {
  OPENROUTER_ALLOWLIST,
  type OpenRouterAllowlistEntry,
} from "@/lib/models/data/openrouter.allowlist"
import type { ModelConfig } from "@/lib/models/types"
import {
  isKnownVendorId,
  MODEL_PROVIDER_IDENTITY,
} from "@/lib/provider-identity"
import prettier from "prettier"

const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models"

const SNAPSHOT_PATH = fileURLToPath(
  new URL("../lib/models/data/openrouter.snapshot.json", import.meta.url)
)
const GENERATED_PATH = fileURLToPath(
  new URL("../lib/models/data/openrouter.generated.ts", import.meta.url)
)

/** The pruned per-model record kept in the snapshot — only fields we consume. */
export type OpenRouterSnapshotModel = {
  id: string
  name: string
  created: number
  expiration_date: string | null
  context_length: number
  top_provider: { max_completion_tokens: number | null }
  pricing: { prompt: string; completion: string }
  supported_parameters: string[]
  architecture: { input_modalities: string[] }
}

export type OpenRouterSnapshot = {
  endpoint: string
  retrievedAt: string
  models: OpenRouterSnapshotModel[]
}

type OpenRouterLiveModel = {
  id: string
  name: string
  created: number
  expiration_date?: string | null
  context_length: number
  top_provider?: { max_completion_tokens?: number | null }
  pricing?: { prompt?: string; completion?: string }
  supported_parameters?: string[]
  architecture?: { input_modalities?: string[] }
}

/**
 * Convert OpenRouter's per-token decimal price string to USD per 1M tokens by
 * shifting the decimal point textually — `0.000000574 * 1e6` under IEEE 754
 * yields float dust that would churn the generated file.
 */
export function pricePerMillionTokens(perTokenPrice: string): number {
  const negative = perTokenPrice.startsWith("-")
  const unsigned = negative ? perTokenPrice.slice(1) : perTokenPrice
  const [whole = "0", fraction = ""] = unsigned.split(".")
  const digits = fraction.padEnd(6, "0")
  const shifted = `${whole}${digits.slice(0, 6)}.${digits.slice(6)}`
  return Number(shifted) * (negative ? -1 : 1)
}

function toIsoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

export function successionStub(slug: string, today: string): string {
  return [
    "  {",
    `    sourceId: "openrouter:${slug}",`,
    `    targetId: "openrouter:<nearest-survivor-slug>",`,
    `    replacementModelId: "openrouter:<nearest-survivor-slug>",`,
    `    verifiedAgainst: "<nearest-survivor-slug>",`,
    `    lastVerifiedAt: "${today}",`,
    "  },",
  ].join("\n")
}

export class MissingAllowlistedIdsError extends Error {
  readonly missingSlugs: string[]

  constructor(missingSlugs: string[], source: string, today: string) {
    const stubs = missingSlugs
      .map((slug) => successionStub(slug, today))
      .join("\n")
    super(
      `${missingSlugs.length} allowlisted OpenRouter id(s) missing from ${source}:\n` +
        missingSlugs.map((slug) => `  - ${slug}`).join("\n") +
        "\n\nDelisted upstream. Never drop an id silently: remove it from " +
        "lib/models/data/openrouter.allowlist.ts AND add a single-hop " +
        "succession targeting a LIVE catalog id to MODEL_ID_SUCCESSIONS in " +
        "lib/models/model-id-migration.ts, e.g.:\n" +
        stubs
    )
    this.name = "MissingAllowlistedIdsError"
    this.missingSlugs = missingSlugs
  }
}

/**
 * Prune a live listing to the allowlisted ids, keep only consumed fields, and
 * sort by id with a fixed key order so refresh diffs stay reviewable.
 * Throws when an allowlisted id is absent from the listing.
 */
export function buildSnapshot(
  liveModels: Array<Record<string, unknown>>,
  allowlist: readonly OpenRouterAllowlistEntry[],
  retrievedAt: string
): OpenRouterSnapshot {
  const liveById = new Map(
    liveModels.map((model) => [model.id as string, model])
  )
  const missing = allowlist
    .map((entry) => entry.slug)
    .filter((slug) => !liveById.has(slug))
  if (missing.length > 0) {
    throw new MissingAllowlistedIdsError(
      missing,
      "the live listing",
      retrievedAt
    )
  }

  const models = allowlist
    .map((entry) => liveById.get(entry.slug) as OpenRouterLiveModel)
    .map((live): OpenRouterSnapshotModel => ({
      id: live.id,
      name: live.name,
      created: live.created,
      expiration_date:
        typeof live.expiration_date === "string" ? live.expiration_date : null,
      context_length: live.context_length,
      top_provider: {
        max_completion_tokens: live.top_provider?.max_completion_tokens ?? null,
      },
      pricing: {
        prompt: live.pricing?.prompt ?? "0",
        completion: live.pricing?.completion ?? "0",
      },
      supported_parameters: [...(live.supported_parameters ?? [])].sort(),
      architecture: {
        input_modalities: [
          ...(live.architecture?.input_modalities ?? []),
        ].sort(),
      },
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  return { endpoint: MODELS_ENDPOINT, retrievedAt, models }
}

/** Join one allowlist entry with its snapshot record into a ModelConfig. */
export function buildModelConfig(
  entry: OpenRouterAllowlistEntry,
  snapshotModel: OpenRouterSnapshotModel,
  retrievedAt: string
): ModelConfig {
  // Reasoning is machine-derived (live `supported_parameters`) with an
  // editorial opt-OUT only — the allowlist can never opt in without the
  // parameter. Configured entries get the construction-time settings expected
  // by the OpenRouter V4 provider (lib/openproviders/provider-strategy.ts).
  const reasoningSupported =
    snapshotModel.supported_parameters.includes("reasoning") &&
    !entry.reasoningOptOut
  const maxCompletionTokens = snapshotModel.top_provider.max_completion_tokens
  const expirationDate = snapshotModel.expiration_date ?? null

  if (entry.lifecycle !== undefined && expirationDate !== null) {
    throw new Error(
      `Allowlist entry "${entry.slug}" has editorial lifecycle evidence and ` +
        `OpenRouter expiration evidence; preserve both sources explicitly ` +
        `before choosing the canonical lifecycle.`
    )
  }
  const lifecycle: ModelConfig["lifecycle"] =
    entry.lifecycle ??
    (expirationDate === null
      ? undefined
      : {
          status: "active",
          source: "openrouter",
          verifiedAt: retrievedAt,
          sourceUrl: MODELS_ENDPOINT,
          retiresAt: expirationDate,
        })

  // `icon` must resolve in the Vendor registry — an unregistered vendor id
  // belongs in `baseProviderId` (open set) with icon "openrouter", not here.
  if (!isKnownVendorId(entry.icon)) {
    throw new Error(
      `Allowlist entry "${entry.slug}" has icon "${entry.icon}", which is not ` +
        `in the Vendor registry (lib/provider-identity.ts). Use a registered ` +
        `vendor id, or "openrouter" when the vendor has no own icon.`
    )
  }

  // `logicalModelId` (ADR-0020) must name an unmapped DIRECT catalog record —
  // never another wrapped id — so the logical catalog can compile the two
  // records into one model. Fail generation, not just downstream compilation.
  if (entry.logicalModelId !== undefined) {
    const target = directModels.find(
      (model) => model.id === entry.logicalModelId
    )
    if (!target) {
      throw new Error(
        `Allowlist entry "${entry.slug}" maps to logical model ` +
          `"${entry.logicalModelId}", which is not a direct catalog id ` +
          `(lib/models/data/direct.ts). Map to the direct record's id, or ` +
          `remove the mapping to keep the entry its own logical model.`
      )
    }
    if (target.logicalModelId !== undefined) {
      throw new Error(
        `Allowlist entry "${entry.slug}" maps to "${entry.logicalModelId}", ` +
          `which is itself mapped — chained logical mappings are ambiguous.`
      )
    }
  }

  return {
    id: `openrouter:${entry.slug}`,
    name: entry.name,
    ...(entry.shortName === undefined ? {} : { shortName: entry.shortName }),
    // Provider identity owns the display name; the generator never restates it.
    provider: MODEL_PROVIDER_IDENTITY.openrouter.name,
    providerId: MODEL_PROVIDER_IDENTITY.openrouter.id,
    catalogStatus: "visible",
    ...(lifecycle === undefined ? {} : { lifecycle }),
    idKind: "wrapped",
    ...(entry.logicalModelId === undefined
      ? {}
      : { logicalModelId: entry.logicalModelId }),
    verifiedAgainst: entry.slug,
    lastVerifiedAt: retrievedAt,
    modelFamily: entry.modelFamily,
    ...(entry.lineageId === undefined ? {} : { lineageId: entry.lineageId }),
    ...(entry.releaseStage === undefined
      ? {}
      : { releaseStage: entry.releaseStage }),
    baseProviderId: entry.baseProviderId,
    description: entry.description,
    tags: entry.tags,
    contextWindow: snapshotModel.context_length,
    // Several live entries (e.g. x-ai/grok-4.3) report null — omit the field.
    ...(maxCompletionTokens == null ? {} : { maxOutput: maxCompletionTokens }),
    inputCost: pricePerMillionTokens(snapshotModel.pricing.prompt),
    outputCost: pricePerMillionTokens(snapshotModel.pricing.completion),
    priceUnit: "per 1M tokens",
    vision: snapshotModel.architecture.input_modalities.includes("image"),
    tools: snapshotModel.supported_parameters.includes("tools"),
    audio: snapshotModel.architecture.input_modalities.includes("audio"),
    reasoningText: reasoningSupported,
    ...(reasoningSupported ? { reasoning: { effort: "medium" as const } } : {}),
    // OpenRouter's server-side search plugin works with every routed model.
    webSearch: true,
    openSource: entry.openSource,
    speed: entry.speed,
    intelligence: entry.intelligence,
    website: "https://openrouter.ai",
    apiDocs: `https://openrouter.ai/${entry.slug}`,
    ...(entry.modelPage ? { modelPage: entry.modelPage } : {}),
    releasedAt: entry.releasedAt ?? toIsoDate(snapshotModel.created),
    ...(entry.snapshotDate === undefined
      ? {}
      : { snapshotDate: entry.snapshotDate }),
    icon: entry.icon,
  }
}

/**
 * Build every ModelConfig in allowlist order. Throws when an allowlisted id
 * is missing from the snapshot.
 */
export function buildCatalog(
  snapshot: OpenRouterSnapshot,
  allowlist: readonly OpenRouterAllowlistEntry[]
): ModelConfig[] {
  const snapshotById = new Map(
    snapshot.models.map((model) => [model.id, model])
  )
  const missing = allowlist
    .map((entry) => entry.slug)
    .filter((slug) => !snapshotById.has(slug))
  if (missing.length > 0) {
    throw new MissingAllowlistedIdsError(
      missing,
      "the committed snapshot",
      snapshot.retrievedAt
    )
  }

  return allowlist.map((entry) =>
    buildModelConfig(
      entry,
      snapshotById.get(entry.slug) as OpenRouterSnapshotModel,
      snapshot.retrievedAt
    )
  )
}

export function renderCatalogModule(
  configs: ModelConfig[],
  retrievedAt: string
): string {
  const entries = configs
    .map((config) => JSON.stringify(config, null, 2))
    .join(",\n")
  return [
    "// GENERATED — do not hand-edit (CI `catalog:openrouter:check` fails on drift).",
    "// Edit lib/models/data/openrouter.allowlist.ts (editorial fields) or refresh",
    "// lib/models/data/openrouter.snapshot.json, then re-run:",
    "//   bun run catalog:openrouter",
    `// Snapshot retrieved: ${retrievedAt} (${MODELS_ENDPOINT}).`,
    'import type { ModelConfig } from "../types"',
    "",
    "export const openrouterModels: ModelConfig[] = [",
    entries,
    "]",
    "",
  ].join("\n")
}

/**
 * Format through prettier with the repo's resolved config so format-on-save
 * is a no-op on the generated file and cannot create phantom --check diffs.
 */
async function formatGeneratedModule(source: string): Promise<string> {
  const config = await prettier.resolveConfig(GENERATED_PATH)
  return prettier.format(source, { ...config, parser: "typescript" })
}

function readCommittedSnapshot(): OpenRouterSnapshot {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as OpenRouterSnapshot
}

function writeSnapshot(snapshot: OpenRouterSnapshot): void {
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRecordArray(
  value: unknown
): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(isRecord)
}

async function generateFromCommittedFiles(): Promise<string> {
  const snapshot = readCommittedSnapshot()
  const configs = buildCatalog(snapshot, OPENROUTER_ALLOWLIST)
  return formatGeneratedModule(
    renderCatalogModule(configs, snapshot.retrievedAt)
  )
}

export async function fetchLiveListing(): Promise<
  Array<Record<string, unknown>>
> {
  const response = await fetch(MODELS_ENDPOINT, {
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    throw new Error(`${MODELS_ENDPOINT} returned HTTP ${response.status}`)
  }
  const body: unknown = await response.json()
  if (!isRecord(body) || !isRecordArray(body.data)) {
    throw new Error(
      `${MODELS_ENDPOINT} returned an unexpected JSON shape: expected { data: Array<object> }`
    )
  }
  return body.data
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const fetchMode = args.includes("--fetch")
  const checkMode = args.includes("--check")

  if (fetchMode) {
    const today = new Date().toISOString().slice(0, 10)
    console.log(`Fetching ${MODELS_ENDPOINT} …`)
    const liveModels = await fetchLiveListing()
    console.log(`  ${liveModels.length} live models`)
    const snapshot = buildSnapshot(liveModels, OPENROUTER_ALLOWLIST, today)
    writeSnapshot(snapshot)
    console.log(
      `  wrote ${SNAPSHOT_PATH} (${snapshot.models.length} allowlisted models, retrievedAt ${today})`
    )
  }

  const generated = await generateFromCommittedFiles()

  if (checkMode) {
    const committed = readFileSync(GENERATED_PATH, "utf8")
    if (committed !== generated) {
      console.error(
        `${GENERATED_PATH} is out of sync with the snapshot + allowlist.\n` +
          "Re-run `bun run catalog:openrouter` and commit the result " +
          "(the generated file is never hand-edited)."
      )
      process.exit(1)
    }
    console.log("Generated OpenRouter catalog is in sync.")
    return
  }

  writeFileSync(GENERATED_PATH, generated)
  console.log(
    `Wrote ${GENERATED_PATH} (${OPENROUTER_ALLOWLIST.length} models).`
  )
}

if (import.meta.main) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
