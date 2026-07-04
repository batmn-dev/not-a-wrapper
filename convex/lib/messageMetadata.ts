import { v, type Infer } from "convex/values"

/**
 * The named shape of a persisted assistant message's `metadata` blob.
 *
 * Before this validator the route persisted `responseMessage.metadata` as an
 * opaque `v.any()`: whatever the AI SDK accumulated across stream parts landed
 * in the database un-namespaced and un-validated, so the metadata module owned
 * the client read/projection but not the stored truth. This is the single
 * source for that shape — it mirrors `ToolInvocationStreamMetadata`
 * (`lib/tools/ui-metadata.ts`), enforced by a type assertion in the tests — and
 * it is both the mutation-args validator (rejects malformed writes at the
 * boundary) and the input of {@link projectPersistedMessageMetadata}.
 *
 * The storage column is narrowed to `vToolInvocationStreamMetadata` in
 * `convex/schema.ts`, and this projector keeps writes aligned to that owned
 * shape by dropping unknown/invalid keys before persistence.
 */
const vToolInvocationDisplayMetadata = v.object({
  displayName: v.string(),
  source: v.union(
    v.literal("builtin"),
    v.literal("third-party"),
    v.literal("mcp"),
    v.literal("platform")
  ),
  serviceName: v.string(),
  icon: v.optional(
    v.union(
      v.literal("search"),
      v.literal("code"),
      v.literal("image"),
      v.literal("extract"),
      v.literal("wrench")
    )
  ),
  estimatedCostPer1k: v.optional(v.number()),
  readOnly: v.optional(v.boolean()),
  destructive: v.optional(v.boolean()),
  idempotent: v.optional(v.boolean()),
  openWorld: v.optional(v.boolean()),
})

export const vToolInvocationStreamMetadata = v.object({
  reasoningDurationMs: v.optional(v.number()),
  toolMetadataByName: v.optional(
    v.record(v.string(), vToolInvocationDisplayMetadata)
  ),
  toolMetadataByCallId: v.optional(
    v.record(v.string(), vToolInvocationDisplayMetadata)
  ),
})

export type PersistedMessageMetadata = Infer<
  typeof vToolInvocationStreamMetadata
>
type DisplayMetadata = Infer<typeof vToolInvocationDisplayMetadata>

const TOOL_SOURCES = new Set(["builtin", "third-party", "mcp", "platform"])
const TOOL_ICONS = new Set(["search", "code", "image", "extract", "wrench"])
const POISON_METADATA_KEYS = new Set(["__proto__", "constructor", "prototype"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function setIfDefined<T>(
  target: Record<string, unknown>,
  key: string,
  value: T | undefined
): void {
  if (value !== undefined) target[key] = value
}

function projectDisplayMetadata(raw: unknown): DisplayMetadata | undefined {
  if (!isRecord(raw)) return undefined
  const { displayName, source, serviceName, icon } = raw
  // Identity fields are required and source must be a known tool source — an
  // entry that fails these cannot be stored under the named validator, so drop
  // it rather than poison the whole blob.
  if (typeof displayName !== "string") return undefined
  if (typeof source !== "string" || !TOOL_SOURCES.has(source)) return undefined
  if (typeof serviceName !== "string") return undefined

  const display: Record<string, unknown> = {
    displayName,
    source,
    serviceName,
  }
  if (typeof icon === "string" && TOOL_ICONS.has(icon)) display.icon = icon
  setIfDefined(
    display,
    "estimatedCostPer1k",
    optionalNumber(raw.estimatedCostPer1k)
  )
  setIfDefined(display, "readOnly", optionalBoolean(raw.readOnly))
  setIfDefined(display, "destructive", optionalBoolean(raw.destructive))
  setIfDefined(display, "idempotent", optionalBoolean(raw.idempotent))
  setIfDefined(display, "openWorld", optionalBoolean(raw.openWorld))
  return display as DisplayMetadata
}

function projectDisplayRecord(
  raw: unknown
): Record<string, DisplayMetadata> | undefined {
  if (!isRecord(raw)) return undefined
  const out = Object.create(null) as Record<string, DisplayMetadata>
  for (const [key, value] of Object.entries(raw)) {
    if (POISON_METADATA_KEYS.has(key)) continue
    const display = projectDisplayMetadata(value)
    if (display) out[key] = display
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Project the SDK-accumulated `responseMessage.metadata` down to the known,
 * named keys before persistence — the single owner of what gets stored. Keys
 * the metadata module does not own (including any the SDK might attach) are
 * dropped rather than persisted opaquely, guaranteeing the stored value passes
 * {@link vToolInvocationStreamMetadata}. Returns `undefined` for an empty or
 * unrecognized blob so nothing is written when there is nothing to store.
 */
export function projectPersistedMessageMetadata(
  raw: unknown
): PersistedMessageMetadata | undefined {
  if (!isRecord(raw)) return undefined
  const result: Record<string, unknown> = {}
  setIfDefined(
    result,
    "reasoningDurationMs",
    optionalNumber(raw.reasoningDurationMs)
  )
  setIfDefined(
    result,
    "toolMetadataByName",
    projectDisplayRecord(raw.toolMetadataByName)
  )
  setIfDefined(
    result,
    "toolMetadataByCallId",
    projectDisplayRecord(raw.toolMetadataByCallId)
  )
  return Object.keys(result).length > 0
    ? (result as PersistedMessageMetadata)
    : undefined
}
