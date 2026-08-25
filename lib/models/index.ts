import {
  getLogicalModel,
  LOGICAL_MODELS,
  ROUTE_CONFIGS,
  resolveModelSelection,
  toLogicalModelView,
  type LogicalModel,
  type LogicalModelView,
} from "./catalog"
import { resolveModelId } from "./model-id-migration"
import { isPlatformEligibleModelForActor } from "./platform-entitlement"
import { ModelConfig } from "./types"

// Route records (ModelConfig) remain the execution-level registry; logical
// models (ADR-0020) are the selector/preference vocabulary compiled from
// them in lib/models/catalog.ts.
const STATIC_MODELS: ModelConfig[] = ROUTE_CONFIGS

export function isVisibleModel(
  model: Pick<ModelConfig, "catalogStatus">
): boolean {
  return model.catalogStatus === "visible"
}

/** Every executable route record (direct + wrapped), any catalog status. */
export async function getAllModels(): Promise<ModelConfig[]> {
  return STATIC_MODELS
}

export async function getVisibleModels(): Promise<ModelConfig[]> {
  const models = await getAllModels()
  return models.filter((model) => isVisibleModel(model))
}

/** Every logical model, any catalog status. */
export function getLogicalModels(): LogicalModel[] {
  return LOGICAL_MODELS
}

export function getVisibleLogicalModels(): LogicalModel[] {
  return LOGICAL_MODELS.filter((model) => isVisibleModel(model))
}

/**
 * The selector payload: one view per visible logical model. `accessible`
 * carries only the PLATFORM half of availability (free-model entitlement for
 * an authenticated user); the client ORs in per-route key presence, and the
 * server route resolver remains the authority at admission.
 */
export function getVisibleLogicalModelViews(
  asOf: Date = new Date()
): LogicalModelView[] {
  return getVisibleLogicalModels().map((model) => ({
    ...toLogicalModelView(model, asOf),
    accessible: isPlatformEligibleModelForActor(model.id, true),
  }))
}

/**
 * Resolve any current or historical selection to its logical client view.
 * Capability flags therefore describe every viable route, while
 * `getModelInfo` remains the route-record lookup used during execution.
 */
export function getLogicalModelInfo(
  modelId: string,
  asOf: Date = new Date()
): LogicalModelView | undefined {
  const selection = resolveModelSelection(modelId)
  const model = getLogicalModel(selection.modelId)
  return model ? toLogicalModelView(model, asOf) : undefined
}

export async function getModelsForProvider(
  provider: string
): Promise<ModelConfig[]> {
  const models = STATIC_MODELS

  const providerModels = models
    .filter((model) => model.providerId === provider)
    .map((model) => ({
      ...model,
      accessible: true,
    }))

  return providerModels
}

// Synchronous route-record lookup. Accepts any historical id: aliases and
// successions resolve first, and every logical id doubles as its canonical
// route id, so logical selections resolve here too.
export function getModelInfo(modelId: string): ModelConfig | undefined {
  const resolvedModelId = resolveModelId(modelId)
  return STATIC_MODELS.find((model) => model.id === resolvedModelId)
}

// For backward compatibility - static models only
export const MODELS: ModelConfig[] = STATIC_MODELS
