import { describe, expect, it } from "vitest"
import { getAllModels } from "./models"
import {
  isKnownVendorId,
  MODEL_PROVIDER_IDENTITY,
} from "./provider-identity"

/**
 * Inventory-drift guard for the Provider identity module (CONTEXT.md).
 * Everything compile-time-total (Record<Provider, …> registries, the icon
 * registry) is deliberately untested here — these are the two facts the type
 * system cannot see across the catalog boundary.
 */
describe("provider identity inventory", () => {
  it("every catalog model carries its provider's canonical display name", async () => {
    const drift = (await getAllModels())
      .filter(
        (model) =>
          model.provider !== MODEL_PROVIDER_IDENTITY[model.providerId].name
      )
      .map(
        (model) =>
          `${model.id}: "${model.provider}" ≠ "${MODEL_PROVIDER_IDENTITY[model.providerId].name}"`
      )
    expect(drift).toEqual([])
  })

  it("every catalog model's icon resolves in the vendor registry", async () => {
    // Unregistered vendors belong in baseProviderId (open set) with icon
    // "openrouter" — the generator enforces this for wrapped entries; this
    // covers the hand-written static model files.
    const drift = (await getAllModels())
      .filter((model) => !model.icon || !isKnownVendorId(model.icon))
      .map((model) => `${model.id}: ${model.icon}`)
    expect(drift).toEqual([])
  })
})
