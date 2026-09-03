"use client"

import { Icon } from "@/components/ui/icon"
import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { useModel } from "@/lib/model-store/provider"
import { getLogicalModelsServedByProvider } from "@/lib/models/catalog"
import { providerHasPlatformEligibleAlternative } from "@/lib/models/platform-entitlement"
import { getVendorIcon } from "@/lib/provider-icons"
import {
  MODEL_PROVIDER_IDENTITY,
  MODEL_PROVIDER_IDS,
  type Provider,
} from "@/lib/provider-identity"
import { cn } from "@/lib/utils"
import { RiAddLine, RiKeyLine } from "@remixicon/react"
import { useMutation as useConvexMutation } from "convex/react"
import type { ComponentType } from "react"
import { ProviderKeyPanel } from "../provider-key-panel"
import type { ProviderKeyConfig } from "../use-provider-keys"

type ModelProvider = ProviderKeyConfig & {
  icon: ComponentType<{ className?: string }>
}

// Thin adapter over the Provider identity module: tiles show the company
// identity (name + company vendor icon), never the product brand.
const MODEL_PROVIDERS: ModelProvider[] = MODEL_PROVIDER_IDS.map((id) => {
  const identity = MODEL_PROVIDER_IDENTITY[id]
  return {
    id,
    name: identity.name,
    icon: getVendorIcon(identity.vendorId),
    ...identity.keySetup,
  }
})

function isModelProviderId(id: string): id is Provider {
  return (MODEL_PROVIDER_IDS as readonly string[]).includes(id)
}

/**
 * Per-provider key details (ADR-0020): the routing preference — where this
 * key sits in the route resolver's candidate order — and which logical
 * models the key can serve. Route policy lives HERE, in key settings, never
 * in the selector.
 */
function ByokProviderDetails({
  providerId,
  hasKey,
}: {
  providerId: Provider
  hasKey: boolean
}) {
  const { data: keySettings } = usePerUserQuery(api.userKeys.getKeySettings)
  const setPreference = useConvexMutation(api.userKeys.setPreference)

  const servedModels = getLogicalModelsServedByProvider(providerId).filter(
    (model) => model.catalogStatus === "visible"
  )
  const preference =
    keySettings?.find((entry) => entry.provider === providerId)?.preference ??
    "priority"
  // Priority vs Fallback only changes behavior when a model this key serves
  // also has a platform-funded path to order against.
  const preferenceMeaningful =
    providerHasPlatformEligibleAlternative(providerId)

  const updatePreference = async (next: "priority" | "fallback") => {
    if (next === preference) return
    try {
      await setPreference({ provider: providerId, preference: next })
    } catch {
      toast({ title: "Failed to update key preference", status: "error" })
    }
  }

  return (
    <div className="mt-4 space-y-3 text-sm">
      {hasKey &&
        (preferenceMeaningful ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">Key usage</div>
              <p className="text-muted-foreground text-xs">
                {preference === "priority"
                  ? "Your key is used first and never spends included allowance."
                  : "Included allowance is used while available; your key covers the rest."}
              </p>
            </div>
            <div
              role="radiogroup"
              aria-label="Key usage preference"
              className="border-border flex shrink-0 rounded-lg border p-0.5"
            >
              {(["priority", "fallback"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={preference === option}
                  onClick={() => updatePreference(option)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs capitalize",
                    preference === option
                      ? "bg-interactive-selected font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            This key is used for every{" "}
            {MODEL_PROVIDER_IDENTITY[providerId].name} request — these models
            have no included platform access to order against.
          </p>
        ))}
      {servedModels.length > 0 && (
        <p className="text-muted-foreground text-xs">
          <span className="text-foreground font-medium">Serves:</span>{" "}
          {servedModels.map((model) => model.name).join(", ")}
        </p>
      )}
    </div>
  )
}

export function ByokSection() {
  const { userKeyStatus } = useModel()

  return (
    <ProviderKeyPanel
      providers={MODEL_PROVIDERS}
      defaultProvider="openrouter"
      keyStatus={userKeyStatus}
      noun="API key"
      header={null}
      tilesClassName="grid grid-cols-2 gap-3 min-[400px]:grid-cols-3 min-[500px]:grid-cols-4"
      renderTile={(provider, { selected, hasKey, onSelect }) => (
        <button
          key={provider.id}
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className={cn(
            "relative flex aspect-square min-w-28 flex-col items-center justify-center gap-2 rounded-lg border p-4",
            selected ? "border-primary ring-primary/30 ring-2" : "border-border"
          )}
        >
          {hasKey && (
            <span className="bg-secondary absolute top-1 right-1 rounded-sm border-[1px] p-1">
              <span className="sr-only">Key configured</span>
              <Icon
                icon={RiKeyLine}
                slotSize={14}
                className="text-secondary-foreground"
              />
            </span>
          )}
          <provider.icon className="size-4" />
          <span>{provider.name}</span>
        </button>
      )}
      tilesExtra={
        <button
          key="soon"
          type="button"
          disabled
          className={cn(
            "flex aspect-square min-w-28 flex-col items-center justify-center gap-2 rounded-lg border p-4 opacity-20",
            "border-primary border-dashed"
          )}
        >
          <Icon icon={RiAddLine} slotSize={16} />
        </button>
      }
      // Key status is reactive (Convex) and the catalog is static, so no
      // post-save refresh port is needed.
      renderDetails={(providerId, { hasKey }) =>
        isModelProviderId(providerId) ? (
          <ByokProviderDetails providerId={providerId} hasKey={hasKey} />
        ) : null
      }
      deleteDescription={(name) => (
        <>
          Are you sure you want to delete your {name} API key? This action
          cannot be undone and you will lose access to {name} models.
        </>
      )}
    />
  )
}
