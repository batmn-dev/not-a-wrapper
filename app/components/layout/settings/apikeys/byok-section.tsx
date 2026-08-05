"use client"

import { Icon } from "@/components/ui/icon"
import { useModel } from "@/lib/model-store/provider"
import { getVendorIcon } from "@/lib/provider-icons"
import {
  MODEL_PROVIDER_IDENTITY,
  MODEL_PROVIDER_IDS,
} from "@/lib/provider-identity"
import { cn } from "@/lib/utils"
import { RiAddLine, RiKeyLine } from "@remixicon/react"
import { useQueryClient } from "@tanstack/react-query"
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

export function ByokSection() {
  const queryClient = useQueryClient()
  const { userKeyStatus, refreshAll } = useModel()

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
      onSaved={async (_provider, result) => {
        // Keep models, key status, and favorites in sync after saving a key.
        await refreshAll()
        if (result.isNewKey) {
          queryClient.invalidateQueries({ queryKey: ["favorite-models"] })
        }
      }}
      onDeleted={async () => {
        await refreshAll()
      }}
      deleteDescription={(name) => (
        <>
          Are you sure you want to delete your {name} API key? This action
          cannot be undone and you will lose access to {name} models.
        </>
      )}
    />
  )
}
