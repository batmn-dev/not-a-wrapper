"use client"

import ClaudeIcon from "@/components/icons/claude"
import GoogleIcon from "@/components/icons/google"
import MistralIcon from "@/components/icons/mistral"
import OpenAIIcon from "@/components/icons/openai"
import OpenRouterIcon from "@/components/icons/openrouter"
import PerplexityIcon from "@/components/icons/perplexity"
import XaiIcon from "@/components/icons/xai"
import { Icon } from "@/components/ui/icon"
import { useModel } from "@/lib/model-store/provider"
import { cn } from "@/lib/utils"
import { RiAddLine, RiKeyLine } from "@remixicon/react"
import { useQueryClient } from "@tanstack/react-query"
import type { ComponentType } from "react"
import { ProviderKeyPanel } from "../provider-key-panel"
import type { ProviderKeyConfig } from "../use-provider-keys"

type ModelProvider = ProviderKeyConfig & {
  icon: ComponentType<{ className?: string }>
}

const MODEL_PROVIDERS: ModelProvider[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    icon: OpenRouterIcon,
    placeholder: "sk-or-v1-...",
    getKeyUrl: "https://openrouter.ai/settings/keys",
    maskHint: "sk-or-v1-............",
  },
  {
    id: "openai",
    name: "OpenAI",
    icon: OpenAIIcon,
    placeholder: "sk-...",
    getKeyUrl: "https://platform.openai.com/api-keys",
    maskHint: "sk-............",
  },
  {
    id: "mistral",
    name: "Mistral",
    icon: MistralIcon,
    placeholder: "...",
    getKeyUrl: "https://console.mistral.ai/api-keys/",
    maskHint: "............",
  },
  {
    id: "google",
    name: "Google",
    icon: GoogleIcon,
    placeholder: "AIza...",
    getKeyUrl: "https://ai.google.dev/gemini-api/docs/api-key",
    maskHint: "AIza............",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    icon: PerplexityIcon,
    placeholder: "pplx-...",
    getKeyUrl: "https://docs.perplexity.ai/guides/getting-started",
    maskHint: "pplx-............",
  },
  {
    id: "xai",
    name: "XAI",
    icon: XaiIcon,
    placeholder: "xai-...",
    getKeyUrl: "https://console.x.ai/",
    maskHint: "xai-............",
  },
  {
    id: "anthropic",
    name: "Claude",
    icon: ClaudeIcon,
    placeholder: "sk-ant-...",
    getKeyUrl: "https://console.anthropic.com/settings/keys",
    maskHint: "sk-ant-............",
  },
]

export function ByokSection() {
  const queryClient = useQueryClient()
  const { userKeyStatus, refreshAll } = useModel()

  return (
    <ProviderKeyPanel
      providers={MODEL_PROVIDERS}
      defaultProvider="openrouter"
      keyStatus={userKeyStatus}
      noun="API key"
      header={
        <>
          <h3 className="relative mb-2 inline-flex text-lg font-medium text-balance">
            Model Providers{" "}
            <span className="text-muted-foreground absolute top-0 -right-7 text-xs">
              new
            </span>
          </h3>
          <p className="text-muted-foreground text-sm text-pretty">
            Add your own API keys to unlock access to models.
          </p>
          <p className="text-muted-foreground text-sm text-pretty">
            Your keys are encrypted before being stored.
          </p>
        </>
      }
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
