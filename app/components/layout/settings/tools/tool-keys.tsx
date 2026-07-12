"use client"

import { Icon } from "@/components/ui/icon"
import { useModel } from "@/lib/model-store/provider"
import {
  TOOL_PROVIDER_IDENTITY,
  TOOL_PROVIDER_IDS,
  type ToolProvider,
} from "@/lib/provider-identity"
import { cn } from "@/lib/utils"
import {
  RiKeyLine,
  RiSearchLine,
  RiWrenchLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import { ProviderKeyPanel } from "../provider-key-panel"
import type { ProviderKeyConfig } from "../use-provider-keys"

type ToolProviderTile = ProviderKeyConfig & {
  description: string
  costEstimate: string
  icon: RemixiconComponentType
}

// Presentation chrome stays adapter-local: tool tiles use generic Remix
// glyphs, not vendor identity.
const TOOL_GLYPHS: Record<ToolProvider, RemixiconComponentType> = {
  exa: RiSearchLine,
  firecrawl: RiWrenchLine,
}

// Thin adapter over the Provider identity module's tool-provider facts.
const TOOL_PROVIDERS: ToolProviderTile[] = TOOL_PROVIDER_IDS.map((id) => {
  const identity = TOOL_PROVIDER_IDENTITY[id]
  return {
    id,
    name: identity.name,
    description: identity.description,
    costEstimate: identity.costEstimate,
    available: identity.available,
    icon: TOOL_GLYPHS[id],
    ...identity.keySetup,
  }
})

function StatusBadge({ hasKey }: { hasKey: boolean }) {
  return hasKey ? (
    <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
      <Icon icon={RiKeyLine} slotSize={12} />
      Your key
    </span>
  ) : (
    <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
      Not configured
    </span>
  )
}

export function ToolKeys() {
  // Key presence comes from the single ModelProvider subscription (Per-user
  // subscription seam), which updates automatically when userKeys changes — so
  // no manual refresh is needed after save/delete.
  const { userKeyStatus } = useModel()

  return (
    <ProviderKeyPanel
      providers={TOOL_PROVIDERS}
      defaultProvider="exa"
      keyStatus={userKeyStatus}
      noun="Tool key"
      header={
        <>
          <h3 className="mb-1 text-lg font-medium text-balance">Tool Keys</h3>
          <p className="text-muted-foreground text-sm text-pretty">
            Add your own API keys for third-party tools. Your keys take priority
            over platform defaults.
          </p>
          <p className="text-muted-foreground mt-0.5 text-sm text-pretty">
            Keys are encrypted before being stored.
          </p>
        </>
      }
      tilesClassName="space-y-3"
      renderTile={(provider, { selected, hasKey, onSelect }) => (
        <button
          key={provider.id}
          type="button"
          disabled={!provider.available}
          aria-pressed={provider.available ? selected : undefined}
          onClick={onSelect}
          className={cn(
            "relative flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
            selected && provider.available
              ? "border-primary ring-primary/30 ring-2"
              : "border-border",
            !provider.available && "cursor-not-allowed opacity-50"
          )}
        >
          <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
            <Icon
              icon={provider.icon}
              slotSize={18}
              className="text-muted-foreground"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{provider.name}</span>
              {provider.available ? (
                <StatusBadge hasKey={hasKey} />
              ) : (
                <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
                  Coming soon
                </span>
              )}
            </div>
            <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
              {provider.description}
            </p>
          </div>
          <div className="text-muted-foreground shrink-0 text-right text-xs">
            {provider.costEstimate}
          </div>
        </button>
      )}
      deleteDescription={(name) => (
        <>
          Are you sure you want to delete your {name} API key? The platform
          default key will be used instead (if available).
        </>
      )}
    />
  )
}
