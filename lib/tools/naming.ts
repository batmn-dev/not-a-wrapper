import type { ToolSet } from "ai"

export const TOOL_NAME_MAX_LENGTH = 128
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/

export type ToolLayer =
  "built-in" | "third-party-search" | "content-extraction" | "platform" | "mcp"

export const TOOL_LAYER_PRECEDENCE: readonly ToolLayer[] = [
  "built-in",
  "third-party-search",
  "content-extraction",
  "platform",
  "mcp",
]

export type ToolLayerMap = Partial<Record<ToolLayer, ToolSet>>

export type ToolNameValidationResult =
  { valid: true } | { valid: false; reason: string }

export type GlobalToolCollision = {
  toolKey: string
  owners: ToolLayer[]
  winner: ToolLayer
}

export type InvalidToolName = {
  toolKey: string
  layer: ToolLayer
  reason: string
}

export type ToolNamingEnforcementResult = {
  sanitizedLayers: ToolLayerMap
  invalid: InvalidToolName[]
  collisions: GlobalToolCollision[]
}

export function validateToolName(name: string): ToolNameValidationResult {
  if (name.length < 1 || name.length > TOOL_NAME_MAX_LENGTH) {
    return { valid: false, reason: `length must be 1..${TOOL_NAME_MAX_LENGTH}` }
  }

  if (!TOOL_NAME_PATTERN.test(name)) {
    return {
      valid: false,
      reason: "allowed characters are ASCII letters, digits, '_', '-', '.'",
    }
  }

  return { valid: true }
}

export function collectInvalidToolNames(
  layers: ToolLayerMap
): InvalidToolName[] {
  const invalid: InvalidToolName[] = []

  for (const layer of TOOL_LAYER_PRECEDENCE) {
    const tools = layers[layer]
    if (!tools) continue

    for (const toolKey of Object.keys(tools)) {
      const result = validateToolName(toolKey)
      if (!result.valid) {
        invalid.push({
          toolKey,
          layer,
          reason: result.reason,
        })
      }
    }
  }

  return invalid.sort((a, b) => a.toolKey.localeCompare(b.toolKey))
}

export function collectGlobalCollisions(
  layers: ToolLayerMap
): GlobalToolCollision[] {
  const ownership = new Map<string, Set<ToolLayer>>()

  for (const layer of TOOL_LAYER_PRECEDENCE) {
    const tools = layers[layer]
    if (!tools) continue

    for (const toolKey of Object.keys(tools)) {
      const owners = ownership.get(toolKey) ?? new Set<ToolLayer>()
      owners.add(layer)
      ownership.set(toolKey, owners)
    }
  }

  const collisions: GlobalToolCollision[] = []

  for (const [toolKey, ownersSet] of ownership) {
    if (ownersSet.size < 2) continue

    const owners = TOOL_LAYER_PRECEDENCE.filter((layer) => ownersSet.has(layer))
    const winner = owners[owners.length - 1]
    if (!winner) continue

    collisions.push({
      toolKey,
      owners,
      winner,
    })
  }

  return collisions.sort((a, b) => a.toolKey.localeCompare(b.toolKey))
}

function removeToolKeys(
  tools: ToolSet | undefined,
  deniedKeys: ReadonlySet<string>
): ToolSet | undefined {
  if (!tools) return undefined
  const filtered: Record<string, unknown> = {}
  for (const [toolKey, descriptor] of Object.entries(tools)) {
    if (deniedKeys.has(toolKey)) continue
    filtered[toolKey] = descriptor
  }
  return filtered as ToolSet
}

export function enforceToolNamingGovernance(
  layers: ToolLayerMap
): ToolNamingEnforcementResult {
  const invalid = collectInvalidToolNames(layers)
  const invalidByLayer = new Map<ToolLayer, Set<string>>()
  for (const entry of invalid) {
    const denied = invalidByLayer.get(entry.layer) ?? new Set<string>()
    denied.add(entry.toolKey)
    invalidByLayer.set(entry.layer, denied)
  }

  const withoutInvalid: ToolLayerMap = {}
  for (const layer of TOOL_LAYER_PRECEDENCE) {
    withoutInvalid[layer] = removeToolKeys(
      layers[layer],
      invalidByLayer.get(layer) ?? new Set<string>()
    )
  }

  const collisions = collectGlobalCollisions(withoutInvalid)
  const collisionLosersByLayer = new Map<ToolLayer, Set<string>>()
  for (const collision of collisions) {
    for (const owner of collision.owners) {
      if (owner === collision.winner) continue
      const denied = collisionLosersByLayer.get(owner) ?? new Set<string>()
      denied.add(collision.toolKey)
      collisionLosersByLayer.set(owner, denied)
    }
  }

  const sanitizedLayers: ToolLayerMap = {}
  for (const layer of TOOL_LAYER_PRECEDENCE) {
    sanitizedLayers[layer] = removeToolKeys(
      withoutInvalid[layer],
      collisionLosersByLayer.get(layer) ?? new Set<string>()
    )
  }

  return {
    sanitizedLayers,
    invalid,
    collisions,
  }
}
