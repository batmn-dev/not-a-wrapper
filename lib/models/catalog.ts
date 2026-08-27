import type { Provider } from "@/lib/provider-identity"
import { resolveToolCapabilities } from "@/lib/tools/types"
import { directModels } from "./data/direct"
import { openrouterModels } from "./data/openrouter"
import { MODEL_RECOMMENDATION_POLICIES } from "./data/recommendations"
import { resolveModelId } from "./model-id-migration"
import { getModelPresentationVendorId } from "./presentation"
import type {
  ModelCatalogStatus,
  ModelConfig,
  ModelLifecycle,
  ModelPriority,
  ModelPriorityReason,
  ModelReasoningEffort,
  ModelRecommendationLaneId,
  ModelRecommendationPolicy,
  ModelReleaseStage,
  SearchMode,
} from "./types"
import { REASONING_EFFORT_LEVELS } from "./types"

const MODEL_SUCCESSOR_GRACE_DAYS = 30
const MODEL_RETIREMENT_PRIORITY_DAYS = 90
const MODEL_LANE_REVIEW_GAP_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Logical model catalog (ADR-0020).
 *
 * Two vocabularies, deliberately distinct:
 *
 *   - **Model route** — a concrete execution path to an upstream provider.
 *     The existing `ModelConfig` record IS the route record; its `id` is the
 *     stable route id, and route-specific facts (capabilities, pricing,
 *     context, reasoning construction) stay on `config` — never flattened
 *     onto the logical model, where they could overstate support.
 *   - **Logical model** — the user-facing model identity the selector and
 *     every persisted preference speak in. Its id equals its CANONICAL route
 *     id (the direct route when one exists, else the sole wrapped route), so
 *     every historical persisted id remains valid without data migration.
 *
 * Routes join a foreign logical model only through the explicit
 * `logicalModelId` field (authored in the OpenRouter allowlist, emitted by
 * the generator). Compilation throws on any ambiguity — a missing target, a
 * chained mapping, a duplicate route id — so a bad mapping fails module
 * load, generation, CI, and tests loudly rather than shipping a duplicate or
 * orphaned selector row.
 */

export type ModelRoute = {
  /** Stable route id — the underlying `ModelConfig.id`. */
  id: string
  /** The logical model this route executes. */
  modelId: string
  providerId: Provider
  /** The id the provider's API expects (wrapped ids lose their namespace). */
  upstreamModelId: string
  /** The full route record: capabilities, pricing, construction settings. */
  config: ModelConfig
}

export type LogicalModel = {
  id: string
  name: string
  shortName?: string
  /** Open-set vendor id for icon/name presentation (the model's MAKER). */
  vendorId: string
  description?: string
  tags?: string[]
  catalogStatus: ModelCatalogStatus
  lineageId?: ModelRecommendationLaneId
  releaseStage?: ModelReleaseStage
  releasedAt?: string
  lifecycle?: ModelLifecycle
  recommendationPolicy?: {
    isCurrent: boolean
    verifiedAt: string
  }
  /** Canonical route first; deterministic order after. */
  routes: ModelRoute[]
}

/**
 * The wire/view shape the client model store holds: the canonical route's
 * display record (so every existing `ModelConfig` consumer keeps working)
 * plus the route summary availability derivations need. Capability flags are
 * widened to "any route supports it" — safe because the route resolver
 * filters candidate routes by required capabilities before selection.
 */
export type LogicalModelView = ModelConfig &
  ModelPriority & {
    routes: Array<{
      id: string
      providerId: Provider
      lifecycle?: ModelLifecycle
    }>
  }

/** The one route-level rule for the app's web-search behavior. */
export function resolveModelSearchMode(
  config: Pick<ModelConfig, "tools" | "searchMode">
): SearchMode {
  return (
    config.searchMode ??
    (resolveToolCapabilities(config.tools).search ? "optional" : "unsupported")
  )
}

function aggregateSearchMode(routes: readonly ModelRoute[]): SearchMode {
  const modes = routes.map((route) => resolveModelSearchMode(route.config))
  if (modes.includes("optional")) return "optional"
  if (modes.includes("always-on")) return "always-on"
  return "unsupported"
}

/**
 * Ordered union of the effort levels any route can serve (ADR-0026). The
 * client renders this union as the effort menu; the route resolver prefers
 * routes supporting the requested level, and Request shaping clamps to the
 * resolved route's own list.
 */
function aggregateEffortLevels(
  routes: readonly ModelRoute[]
): ModelReasoningEffort[] {
  const available = new Set<ModelReasoningEffort>()
  for (const route of routes) {
    for (const level of route.config.effortLevels ?? []) available.add(level)
  }
  return REASONING_EFFORT_LEVELS.filter((level) => available.has(level))
}

/**
 * The default level the effort menu shows as implicitly selected (ADR-0026):
 * the first effort-capable route's default in route-precedence order. The
 * canonical route alone is not enough — a model whose direct route has no
 * effort knob (e.g. Gemini 2.5 budgets) still gets a menu from its wrapped
 * route, and a menu without a default would leave no path back to the
 * no-override state.
 */
function aggregateDefaultEffort(
  routes: readonly ModelRoute[]
): ModelReasoningEffort | undefined {
  for (const route of routes) {
    if (
      route.config.effortLevels?.length &&
      route.config.defaultEffort !== undefined
    ) {
      return route.config.defaultEffort
    }
  }
  return undefined
}

export function toUpstreamModelId(routeId: string): string {
  return routeId.startsWith("openrouter:")
    ? routeId.slice("openrouter:".length)
    : routeId
}

function toRoute(config: ModelConfig, modelId: string): ModelRoute {
  return {
    id: config.id,
    modelId,
    providerId: config.providerId,
    upstreamModelId: toUpstreamModelId(config.id),
    config,
  }
}

/**
 * Compile route records into logical models. Pure and deterministic over the
 * input order: unmapped records become logical models in declaration order;
 * mapped records attach to their target as non-canonical routes.
 */
export function compileLogicalCatalog(
  configs: readonly ModelConfig[],
  recommendationPolicies: readonly ModelRecommendationPolicy[] = []
): LogicalModel[] {
  const byId = new Map<string, ModelConfig>()
  for (const config of configs) {
    if (byId.has(config.id)) {
      throw new Error(
        `Logical catalog: duplicate route id "${config.id}" — every route ` +
          `record needs a unique id.`
      )
    }
    byId.set(config.id, config)
  }

  const models = new Map<string, LogicalModel>()
  for (const config of configs) {
    if (config.logicalModelId !== undefined) continue
    models.set(config.id, {
      id: config.id,
      name: config.name,
      ...(config.shortName === undefined
        ? {}
        : { shortName: config.shortName }),
      vendorId: getModelPresentationVendorId(config),
      ...(config.description === undefined
        ? {}
        : { description: config.description }),
      ...(config.tags === undefined ? {} : { tags: config.tags }),
      catalogStatus: config.catalogStatus,
      ...(config.lineageId === undefined
        ? {}
        : { lineageId: config.lineageId }),
      ...(config.releaseStage === undefined
        ? {}
        : { releaseStage: config.releaseStage }),
      ...(config.releasedAt === undefined
        ? {}
        : { releasedAt: config.releasedAt }),
      ...(config.lifecycle === undefined
        ? {}
        : { lifecycle: config.lifecycle }),
      routes: [toRoute(config, config.id)],
    })
  }

  for (const config of configs) {
    if (config.logicalModelId === undefined) continue
    const target = byId.get(config.logicalModelId)
    if (!target) {
      throw new Error(
        `Logical catalog: route "${config.id}" maps to logical model ` +
          `"${config.logicalModelId}", which does not exist in the catalog.`
      )
    }
    if (target.logicalModelId !== undefined) {
      throw new Error(
        `Logical catalog: route "${config.id}" maps to "${target.id}", ` +
          `which is itself mapped to "${target.logicalModelId}" — chained ` +
          `mappings are ambiguous.`
      )
    }
    const model = models.get(config.logicalModelId)
    if (!model) {
      throw new Error(
        `Logical catalog: route "${config.id}" maps to ` +
          `"${config.logicalModelId}", which produced no logical model.`
      )
    }
    if (model.routes.some((route) => route.providerId === config.providerId)) {
      throw new Error(
        `Logical catalog: logical model "${model.id}" would carry two ` +
          `${config.providerId} routes ("${config.id}") — one route per ` +
          `provider per model.`
      )
    }
    model.routes.push(toRoute(config, model.id))
  }

  const logicalModels = [...models.values()]
  validateLogicalCatalogLifecycle(logicalModels)
  applyRecommendationPolicies(logicalModels, recommendationPolicies)
  return logicalModels
}

function dateTimestamp(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const parsed = new Date(timestamp)

  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? timestamp
    : undefined
}

function requireCatalogDate(value: string, field: string, modelId: string) {
  if (dateTimestamp(value) !== undefined) return
  throw new Error(
    `Logical catalog: model "${modelId}" has invalid ${field} date "${value}".`
  )
}

function applyRecommendationPolicies(
  models: readonly LogicalModel[],
  policies: readonly ModelRecommendationPolicy[]
) {
  const byId = new Map(models.map((model) => [model.id, model]))
  const seenVendors = new Set<string>()

  for (const policy of policies) {
    requireCatalogDate(
      policy.verifiedAt,
      "recommendationPolicy.verifiedAt",
      policy.vendorId
    )
    if (seenVendors.has(policy.vendorId)) {
      throw new Error(
        `Logical catalog: duplicate recommendation policy for vendor ` +
          `"${policy.vendorId}".`
      )
    }
    seenVendors.add(policy.vendorId)

    const currentIds = new Set(policy.currentModelIds)
    if (currentIds.size !== policy.currentModelIds.length) {
      throw new Error(
        `Logical catalog: recommendation policy for vendor ` +
          `"${policy.vendorId}" contains duplicate model ids.`
      )
    }
    if (currentIds.size === 0) {
      throw new Error(
        `Logical catalog: recommendation policy for vendor ` +
          `"${policy.vendorId}" has no current models.`
      )
    }

    for (const modelId of currentIds) {
      const model = byId.get(modelId)
      if (!model) {
        throw new Error(
          `Logical catalog: recommendation policy for vendor ` +
            `"${policy.vendorId}" names missing model "${modelId}".`
        )
      }
      if (model.vendorId !== policy.vendorId) {
        throw new Error(
          `Logical catalog: recommendation policy for vendor ` +
            `"${policy.vendorId}" names model "${modelId}" from vendor ` +
            `"${model.vendorId}".`
        )
      }
      if (model.catalogStatus !== "visible") {
        throw new Error(
          `Logical catalog: recommendation policy for vendor ` +
            `"${policy.vendorId}" names hidden model "${modelId}".`
        )
      }
    }

    for (const model of models) {
      if (model.vendorId !== policy.vendorId) continue
      model.recommendationPolicy = {
        isCurrent: currentIds.has(model.id),
        verifiedAt: policy.verifiedAt,
      }
    }
  }
}

function validateLogicalCatalogLifecycle(models: readonly LogicalModel[]) {
  const byId = new Map(models.map((model) => [model.id, model]))

  for (const model of models) {
    if (model.releasedAt !== undefined) {
      requireCatalogDate(model.releasedAt, "releasedAt", model.id)
    }

    for (const route of model.routes) {
      if (route.config.snapshotDate !== undefined) {
        requireCatalogDate(route.config.snapshotDate, "snapshotDate", route.id)
      }

      const lifecycle = route.config.lifecycle
      if (!lifecycle) continue

      requireCatalogDate(lifecycle.verifiedAt, "lifecycle.verifiedAt", route.id)
      if (lifecycle.retiresAt !== undefined) {
        requireCatalogDate(lifecycle.retiresAt, "lifecycle.retiresAt", route.id)
      }

      const replacementId = lifecycle.replacementModelId
      if (replacementId === undefined) continue
      const replacement = byId.get(replacementId)
      if (!replacement) {
        throw new Error(
          `Logical catalog: model "${route.id}" names missing lifecycle ` +
            `replacement "${replacementId}".`
        )
      }
      if (replacement.catalogStatus !== "visible") {
        throw new Error(
          `Logical catalog: model "${route.id}" names non-visible lifecycle ` +
            `replacement "${replacementId}".`
        )
      }
      if (
        model.lineageId !== undefined &&
        replacement.lineageId !== undefined &&
        model.lineageId !== replacement.lineageId &&
        !lifecycle.sourceUrl?.trim()
      ) {
        throw new Error(
          `Logical catalog: model "${route.id}" crosses recommendation ` +
            `lanes to replacement "${replacementId}" without a sourceUrl.`
        )
      }
    }
  }

  const replacementById = new Map(
    models.flatMap((model) => {
      const replacementId = model.lifecycle?.replacementModelId
      return replacementId === undefined ? [] : [[model.id, replacementId]]
    })
  )
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(modelId: string, path: string[]) {
    if (visited.has(modelId)) return
    if (visiting.has(modelId)) {
      const cycleStart = path.indexOf(modelId)
      const cycle = [...path.slice(cycleStart), modelId].join(" -> ")
      throw new Error(`Logical catalog: lifecycle replacement cycle ${cycle}.`)
    }

    visiting.add(modelId)
    const replacementId = replacementById.get(modelId)
    if (replacementId !== undefined) {
      visit(replacementId, [...path, modelId])
    }
    visiting.delete(modelId)
    visited.add(modelId)
  }

  for (const modelId of replacementById.keys()) visit(modelId, [])
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function currentPriority(): ModelPriority {
  return { classification: "current" }
}

function lifecyclePriorityReason(
  status: Exclude<ModelLifecycle["status"], "active">
): ModelPriorityReason {
  switch (status) {
    case "legacy":
      return "lifecycle_legacy"
    case "deprecated":
      return "lifecycle_deprecated"
    case "retired":
      return "lifecycle_retired"
  }
}

function lifecyclePriorityAt(
  lifecycle: ModelLifecycle | undefined,
  asOfTimestamp: number
): ModelPriority | undefined {
  if (!lifecycle) return undefined
  const verifiedAt = dateTimestamp(lifecycle.verifiedAt)
  if (verifiedAt === undefined || verifiedAt > asOfTimestamp) return undefined

  if (lifecycle.status !== "active") {
    return {
      classification: "legacy",
      classificationReason: lifecyclePriorityReason(lifecycle.status),
      classificationSource: lifecycle.source,
      ...(lifecycle.replacementModelId === undefined
        ? {}
        : { successorModelId: lifecycle.replacementModelId }),
      classificationEffectiveAt: lifecycle.verifiedAt,
    }
  }

  if (lifecycle.replacementModelId !== undefined) {
    return {
      classification: "legacy",
      classificationReason: "superseded",
      classificationSource: lifecycle.source,
      successorModelId: lifecycle.replacementModelId,
      classificationEffectiveAt: lifecycle.verifiedAt,
    }
  }

  const retiresAt = lifecycle.retiresAt
    ? dateTimestamp(lifecycle.retiresAt)
    : undefined
  if (retiresAt === undefined) return undefined

  const effectiveAt = retiresAt - MODEL_RETIREMENT_PRIORITY_DAYS * DAY_MS
  return asOfTimestamp >= effectiveAt
    ? {
        classification: "legacy",
        classificationReason: "retirement_scheduled",
        classificationSource: lifecycle.source,
        classificationEffectiveAt: isoDate(effectiveAt),
      }
    : undefined
}

function recommendationPolicyPriorityAt(
  policy: LogicalModel["recommendationPolicy"],
  asOfTimestamp: number
): ModelPriority | undefined {
  if (!policy) return undefined
  const verifiedAt = dateTimestamp(policy.verifiedAt)
  if (verifiedAt === undefined || verifiedAt > asOfTimestamp) return undefined
  if (policy.isCurrent) return currentPriority()

  return {
    classification: "legacy",
    classificationReason: "not_recommended",
    classificationSource: "editorial",
    classificationEffectiveAt: policy.verifiedAt,
  }
}

/**
 * Classify a logical model from dated lifecycle evidence, an exact maker
 * policy, or an explicit recommendation lane. Age alone never makes a model
 * legacy. A newer preview also never supersedes a stable predecessor.
 */
export function classifyLogicalModel(
  model: LogicalModel,
  catalog: readonly LogicalModel[],
  asOf: Date
): ModelPriority {
  const asOfTimestamp = asOf.getTime()
  if (Number.isNaN(asOfTimestamp)) {
    throw new Error("Model classification requires a valid asOf date.")
  }

  const lifecyclePriority = lifecyclePriorityAt(model.lifecycle, asOfTimestamp)
  if (lifecyclePriority) return lifecyclePriority

  const recommendationPriority = recommendationPolicyPriorityAt(
    model.recommendationPolicy,
    asOfTimestamp
  )
  if (recommendationPriority) return recommendationPriority

  const releasedAt = model.releasedAt
    ? dateTimestamp(model.releasedAt)
    : undefined
  if (model.lineageId === undefined || releasedAt === undefined) {
    return currentPriority()
  }

  const eligibleSuccessors = catalog
    .filter(
      (candidate) =>
        candidate.id !== model.id &&
        candidate.lineageId === model.lineageId &&
        candidate.catalogStatus === "visible" &&
        (candidate.releaseStage ?? "stable") === "stable" &&
        lifecyclePriorityAt(candidate.lifecycle, asOfTimestamp) === undefined
    )
    .map((candidate) => ({
      model: candidate,
      releasedAt: candidate.releasedAt
        ? dateTimestamp(candidate.releasedAt)
        : undefined,
    }))
    .filter(
      (candidate): candidate is { model: LogicalModel; releasedAt: number } =>
        candidate.releasedAt !== undefined &&
        candidate.releasedAt > releasedAt &&
        candidate.releasedAt <= asOfTimestamp
    )

  if (eligibleSuccessors.length === 0) return currentPriority()

  const firstSuccessorRelease = Math.min(
    ...eligibleSuccessors.map((candidate) => candidate.releasedAt)
  )
  const effectiveAt =
    firstSuccessorRelease + MODEL_SUCCESSOR_GRACE_DAYS * DAY_MS
  if (asOfTimestamp < effectiveAt) return currentPriority()

  const recommendedSuccessor = eligibleSuccessors.toSorted(
    (left, right) => right.releasedAt - left.releasedAt
  )[0]!

  return {
    classification: "legacy",
    classificationReason: "superseded",
    successorModelId: recommendedSuccessor.model.id,
    classificationEffectiveAt: isoDate(effectiveAt),
  }
}

export type ModelPriorityAuditIssue = {
  code: "stale_recommendation_lane"
  laneId: ModelRecommendationLaneId
  vendorId: string
  modelId: string
  newestVendorModelId: string
  releaseGapDays: number
}

/**
 * Report recommendation lanes that may have been orphaned by a newer product
 * generation from the same maker. This never changes classification: release
 * age requests editorial review, while only lifecycle, maker-policy, or lane
 * evidence makes a model Legacy.
 */
export function auditLogicalModelPriorities(
  catalog: readonly LogicalModel[],
  asOf: Date,
  reviewGapDays = MODEL_LANE_REVIEW_GAP_DAYS
): ModelPriorityAuditIssue[] {
  const asOfTimestamp = asOf.getTime()
  if (Number.isNaN(asOfTimestamp)) {
    throw new Error("Model priority audit requires a valid asOf date.")
  }
  if (!Number.isFinite(reviewGapDays) || reviewGapDays < 0) {
    throw new Error("Model priority audit requires a non-negative review gap.")
  }

  const currentStableModels = catalog
    .map((model) => ({
      model,
      releasedAt: model.releasedAt
        ? dateTimestamp(model.releasedAt)
        : undefined,
    }))
    .filter(
      (entry): entry is { model: LogicalModel; releasedAt: number } =>
        entry.releasedAt !== undefined &&
        entry.releasedAt <= asOfTimestamp &&
        entry.model.catalogStatus === "visible" &&
        (entry.model.releaseStage ?? "stable") === "stable" &&
        classifyLogicalModel(entry.model, catalog, asOf).classification ===
          "current"
    )

  const newestByVendor = new Map<
    string,
    { model: LogicalModel; releasedAt: number }
  >()
  const newestByLane = new Map<
    ModelRecommendationLaneId,
    { model: LogicalModel; releasedAt: number }
  >()

  for (const entry of currentStableModels) {
    const vendorEntry = newestByVendor.get(entry.model.vendorId)
    if (!vendorEntry || entry.releasedAt > vendorEntry.releasedAt) {
      newestByVendor.set(entry.model.vendorId, entry)
    }

    const laneId = entry.model.lineageId
    if (laneId === undefined) continue
    const laneEntry = newestByLane.get(laneId)
    if (!laneEntry || entry.releasedAt > laneEntry.releasedAt) {
      newestByLane.set(laneId, entry)
    }
  }

  return [...newestByLane.entries()]
    .flatMap(([laneId, laneEntry]) => {
      const vendorEntry = newestByVendor.get(laneEntry.model.vendorId)
      if (!vendorEntry) return []

      const releaseGapDays = Math.floor(
        (vendorEntry.releasedAt - laneEntry.releasedAt) / DAY_MS
      )
      if (releaseGapDays < reviewGapDays) return []

      return [
        {
          code: "stale_recommendation_lane" as const,
          laneId,
          vendorId: laneEntry.model.vendorId,
          modelId: laneEntry.model.id,
          newestVendorModelId: vendorEntry.model.id,
          releaseGapDays,
        },
      ]
    })
    .toSorted(
      (left, right) =>
        left.vendorId.localeCompare(right.vendorId) ||
        left.laneId.localeCompare(right.laneId)
    )
}

/** Every route record the app can execute, in curated declaration order. */
export const ROUTE_CONFIGS: ModelConfig[] = [
  ...directModels,
  ...openrouterModels,
]

export const LOGICAL_MODELS: LogicalModel[] = compileLogicalCatalog(
  ROUTE_CONFIGS,
  MODEL_RECOMMENDATION_POLICIES
)

const LOGICAL_MODEL_BY_ID = new Map(
  LOGICAL_MODELS.map((model) => [model.id, model])
)

const ROUTE_BY_ID = new Map(
  LOGICAL_MODELS.flatMap((model) =>
    model.routes.map((route) => [route.id, route] as const)
  )
)

export function getLogicalModel(modelId: string): LogicalModel | undefined {
  return LOGICAL_MODEL_BY_ID.get(modelId)
}

export function getModelRoute(routeId: string): ModelRoute | undefined {
  return ROUTE_BY_ID.get(routeId)
}

export function isLogicalModelId(modelId: string): boolean {
  return LOGICAL_MODEL_BY_ID.has(modelId)
}

export type ResolvedModelSelection = {
  /** The logical model id the selection means. */
  modelId: string
  /**
   * Present when the original selection named a specific non-canonical route
   * (an old `openrouter:*` id now merged into a direct logical model): the
   * historical route, preserved as a routing preference — never a second
   * selector identity.
   */
  legacyRouteHint?: string
}

/**
 * The one compatibility layer from any persisted/legacy model id to logical
 * identity. Aliases and successions resolve first (single hop, unchanged
 * semantics from lib/models/model-id-migration.ts); a route id that belongs
 * to a merged logical model then resolves to that model with the route kept
 * as a hint. Unknown ids pass through unchanged so downstream "model not
 * found" handling stays intact.
 */
export function resolveModelSelection(modelId: string): ResolvedModelSelection {
  const resolved = resolveModelId(modelId)
  const route = ROUTE_BY_ID.get(resolved)
  if (route && route.modelId !== route.id) {
    return { modelId: route.modelId, legacyRouteHint: route.id }
  }
  return { modelId: resolved }
}

/** Resolve any current or historical selection to its logical search state. */
export function resolveLogicalModelSearchMode(
  modelId: string
): SearchMode | undefined {
  const selection = resolveModelSelection(modelId)
  const model = getLogicalModel(selection.modelId)
  return model ? aggregateSearchMode(model.routes) : undefined
}

/**
 * Resolve any current or historical selection to its logical effort-level
 * union (ADR-0026). Empty array → no route offers a per-turn effort knob.
 */
export function resolveLogicalModelEffortLevels(
  modelId: string
): ModelReasoningEffort[] | undefined {
  const selection = resolveModelSelection(modelId)
  const model = getLogicalModel(selection.modelId)
  return model ? aggregateEffortLevels(model.routes) : undefined
}

/** Normalize a list of selections to unique logical ids, preserving order. */
export function resolveModelSelections(modelIds: readonly string[]): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const modelId of modelIds) {
    const { modelId: logicalId } = resolveModelSelection(modelId)
    if (seen.has(logicalId)) continue
    seen.add(logicalId)
    normalized.push(logicalId)
  }
  return normalized
}

/** Logical models a key for `provider` can serve (any catalog status). */
export function getLogicalModelsServedByProvider(
  provider: Provider
): LogicalModel[] {
  return LOGICAL_MODELS.filter((model) =>
    model.routes.some((route) => route.providerId === provider)
  )
}

/**
 * Project a logical model into the client view shape: the canonical route's
 * record (whose id already equals the logical id) with capability flags
 * widened across routes, the aggregated search mode, and the provider summary.
 */
export function toLogicalModelView(
  model: LogicalModel,
  asOf: Date = new Date()
): LogicalModelView {
  const canonical = model.routes[0]!.config
  const priority = classifyLogicalModel(model, LOGICAL_MODELS, asOf)
  const effortLevels = aggregateEffortLevels(model.routes)
  return {
    ...canonical,
    ...priority,
    ...(model.shortName === undefined ? {} : { shortName: model.shortName }),
    vision: model.routes.some((route) => route.config.vision === true),
    audio: model.routes.some((route) => route.config.audio === true),
    reasoningText: model.routes.some(
      (route) => route.config.reasoningText === true
    ),
    ...(effortLevels.length === 0
      ? {}
      : {
          effortLevels,
          defaultEffort: aggregateDefaultEffort(model.routes),
        }),
    searchMode: aggregateSearchMode(model.routes),
    tools: model.routes.some((route) => Boolean(route.config.tools))
      ? true
      : canonical.tools,
    routes: model.routes.map((route) => ({
      id: route.id,
      providerId: route.providerId,
      ...(route.config.lifecycle === undefined
        ? {}
        : { lifecycle: route.config.lifecycle }),
    })),
  }
}
