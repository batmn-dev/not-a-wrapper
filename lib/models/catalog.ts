import type { Provider } from "@/lib/provider-identity"
import { directModels } from "./data/direct"
import { openrouterModels } from "./data/openrouter"
import { resolveModelId } from "./model-id-migration"
import type { ModelCatalogStatus, ModelConfig } from "./types"

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
  /** Open-set vendor id for icon/name presentation (the model's MAKER). */
  vendorId: string
  description?: string
  tags?: string[]
  catalogStatus: ModelCatalogStatus
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
export type LogicalModelView = ModelConfig & {
  routes: Array<{ id: string; providerId: Provider }>
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
  configs: readonly ModelConfig[]
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
      vendorId: config.icon ?? config.baseProviderId,
      ...(config.description === undefined
        ? {}
        : { description: config.description }),
      ...(config.tags === undefined ? {} : { tags: config.tags }),
      catalogStatus: config.catalogStatus,
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

  return [...models.values()]
}

/** Every route record the app can execute, in curated declaration order. */
export const ROUTE_CONFIGS: ModelConfig[] = [
  ...directModels,
  ...openrouterModels,
]

export const LOGICAL_MODELS: LogicalModel[] = compileLogicalCatalog(
  ROUTE_CONFIGS
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

/** Normalize a list of selections to unique logical ids, preserving order. */
export function resolveModelSelections(
  modelIds: readonly string[]
): string[] {
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
 * widened to "any route supports it" and the per-route provider summary.
 */
export function toLogicalModelView(model: LogicalModel): LogicalModelView {
  const canonical = model.routes[0]!.config
  return {
    ...canonical,
    vision: model.routes.some((route) => route.config.vision === true),
    audio: model.routes.some((route) => route.config.audio === true),
    reasoningText: model.routes.some(
      (route) => route.config.reasoningText === true
    ),
    tools: model.routes.some((route) => Boolean(route.config.tools))
      ? true
      : canonical.tools,
    routes: model.routes.map((route) => ({
      id: route.id,
      providerId: route.providerId,
    })),
  }
}
