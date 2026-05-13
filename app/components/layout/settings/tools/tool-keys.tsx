"use client"
import { RiDeleteBinLine, RiExternalLinkLine, RiKeyLine, RiLoader4Line, RiSearchLine, RiWrenchLine } from "@remixicon/react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
import { fetchClient } from "@/lib/fetch"
import { cn } from "@/lib/utils"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useMutation } from "@tanstack/react-query"
import { useState, useMemo } from "react"

type ToolProvider = {
  id: string
  name: string
  description: string
  placeholder: string
  getKeyUrl: string
  costEstimate: string
  /** Cost per 1,000 invocations in USD (from ToolMetadata.estimatedCostPer1k) */
  costPer1k: number
  icon: typeof RiSearchLine
  /** Whether this tool is currently available for use */
  available: boolean
}

const TOOL_PROVIDERS: ToolProvider[] = [
  {
    id: "exa",
    name: "Exa",
    description:
      "AI-native web search. Powers search for models without built-in search (Mistral, OpenRouter, Perplexity).",
    placeholder: "exa-...",
    getKeyUrl: "https://dashboard.exa.ai/api-keys",
    costEstimate: "~$0.005 per search",
    costPer1k: 5,
    icon: RiSearchLine,
    available: true,
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    description:
      "Web scraping and content extraction. Enables structured data extraction from web pages.",
    placeholder: "fc-...",
    getKeyUrl: "https://www.firecrawl.dev/app/api-keys",
    costEstimate: "~$0.001 per page",
    costPer1k: 1,
    icon: RiWrenchLine,
    available: false, // Not yet integrated — Phase 7
  },
]

type KeyStatus = "user-key" | "platform" | "none"

function getStatusBadge(status: KeyStatus) {
  switch (status) {
    case "user-key":
      return (
        <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
          <RiKeyLine size={12} className="size-3" />
          Your key
        </span>
      )
    case "platform":
      return (
        <span className="bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
          Platform default
        </span>
      )
    case "none":
      return (
        <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
          Not configured
        </span>
      )
  }
}

export function ToolKeys() {
  // Reactive Convex query — returns all provider IDs that have stored keys
  const storedProviders = useQuery(api.userKeys.getProviderStatus)

  const [selectedProvider, setSelectedProvider] = useState<string>("exa")
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [providerToDelete, setProviderToDelete] = useState<string>("")

  const selectedProviderConfig = TOOL_PROVIDERS.find(
    (p) => p.id === selectedProvider
  )

  // Determine key status for each tool provider
  const keyStatuses = useMemo(() => {
    const statuses: Record<string, KeyStatus> = {}
    for (const provider of TOOL_PROVIDERS) {
      const hasUserKey = storedProviders?.includes(provider.id) ?? false
      statuses[provider.id] = hasUserKey ? "user-key" : "none"
    }
    return statuses
  }, [storedProviders])

  const hasUserKey = (providerId: string) =>
    keyStatuses[providerId] === "user-key"

  const getProviderValue = (providerId: string) => {
    if (apiKeys[providerId]) return apiKeys[providerId]
    if (hasUserKey(providerId)) return "••••••••••••"
    return ""
  }

  const saveMutation = useMutation({
    mutationFn: async ({
      provider,
      apiKey,
    }: {
      provider: string
      apiKey: string
    }) => {
      const res = await fetchClient("/api/user-keys", {
        method: "POST",
        body: JSON.stringify({ provider, apiKey }),
      })
      if (!res.ok) throw new Error("Failed to save key")
      return res.json()
    },
    onSuccess: (_response: { isNewKey?: boolean }, { provider }: { provider: string; apiKey: string }) => {
      const providerConfig = TOOL_PROVIDERS.find((p) => p.id === provider)
      toast({
        title: "Tool key saved",
        description: `Your ${providerConfig?.name} API key has been saved.`,
      })
      setApiKeys((prev) => ({ ...prev, [provider]: "" }))
    },
    onError: (_error: Error, { provider }: { provider: string; apiKey: string }) => {
      const providerConfig = TOOL_PROVIDERS.find((p) => p.id === provider)
      toast({
        title: "Failed to save key",
        description: `Failed to save ${providerConfig?.name} API key. Please try again.`,
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (provider: string) => {
      const res = await fetchClient("/api/user-keys", {
        method: "DELETE",
        body: JSON.stringify({ provider }),
      })
      if (!res.ok) throw new Error("Failed to delete key")
      return res
    },
    onSuccess: (_response: Response, provider: string) => {
      const providerConfig = TOOL_PROVIDERS.find((p) => p.id === provider)
      toast({
        title: "Tool key deleted",
        description: `Your ${providerConfig?.name} API key has been deleted.`,
      })
      setApiKeys((prev) => ({ ...prev, [provider]: "" }))
      setDeleteDialogOpen(false)
      setProviderToDelete("")
    },
    onError: (_error: Error, provider: string) => {
      const providerConfig = TOOL_PROVIDERS.find((p) => p.id === provider)
      toast({
        title: "Failed to delete key",
        description: `Failed to delete ${providerConfig?.name} API key. Please try again.`,
      })
      setDeleteDialogOpen(false)
      setProviderToDelete("")
    },
  })

  const handleSave = (providerId: string) => {
    const value = apiKeys[providerId]
    if (!value || value === "••••••••••••") {
      toast({
        title: "No key entered",
        description: "Please enter an API key before saving.",
      })
      return
    }
    saveMutation.mutate({ provider: providerId, apiKey: value })
  }

  const handleDeleteClick = (providerId: string) => {
    setProviderToDelete(providerId)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = () => {
    if (providerToDelete) {
      deleteMutation.mutate(providerToDelete)
    }
  }

  return (
    <div>
      <h3 className="mb-1 text-lg font-medium text-balance">Tool Keys</h3>
      <p className="text-muted-foreground text-sm text-pretty">
        Add your own API keys for third-party tools. Your keys take priority
        over platform defaults.
      </p>
      <p className="text-muted-foreground mt-0.5 text-sm text-pretty">
        Keys are stored securely with end-to-end encryption.
      </p>

      <div className="mt-4 space-y-3">
        {TOOL_PROVIDERS.map((provider) => {
          const ProviderIcon = provider.icon

          return (
            <button
              key={provider.id}
              type="button"
              disabled={!provider.available}
              onClick={() => setSelectedProvider(provider.id)}
              className={cn(
                "relative flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                selectedProvider === provider.id && provider.available
                  ? "border-primary ring-primary/30 ring-2"
                  : "border-border",
                !provider.available && "cursor-not-allowed opacity-50"
              )}
            >
              <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
                <ProviderIcon size={18} className="text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{provider.name}</span>
                  {provider.available
                    ? getStatusBadge(keyStatuses[provider.id] ?? "none")
                    : (
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
          )
        })}
      </div>

      {selectedProviderConfig?.available && (
        <div className="mt-4">
          <div className="flex flex-col">
            <Label htmlFor={`${selectedProvider}-tool-key`} className="mb-3">
              {selectedProviderConfig.name} API Key
            </Label>
            <Input
              id={`${selectedProvider}-tool-key`}
              type="password"
              placeholder={selectedProviderConfig.placeholder}
              value={getProviderValue(selectedProvider)}
              onChange={(e) =>
                setApiKeys((prev) => ({
                  ...prev,
                  [selectedProvider]: e.target.value,
                }))
              }
              onFocus={() => {
                // Clear placeholder dots on focus so user can type
                if (
                  hasUserKey(selectedProvider) &&
                  !apiKeys[selectedProvider]
                ) {
                  setApiKeys((prev) => ({ ...prev, [selectedProvider]: "" }))
                }
              }}
              disabled={saveMutation.isPending}
            />
            <div className="mt-0 flex justify-between pl-1">
              <a
                href={selectedProviderConfig.getKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground mt-1 inline-flex items-center gap-1 text-xs hover:underline"
              >
                <RiExternalLinkLine size={12} className="size-3" />
                Get API key
              </a>
              <div className="flex gap-2">
                {hasUserKey(selectedProvider) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => handleDeleteClick(selectedProvider)}
                    disabled={
                      deleteMutation.isPending || saveMutation.isPending
                    }
                  >
                    <RiDeleteBinLine
                      size={16}
                      className="mr-1"
                    />
                    Delete
                  </Button>
                )}
                <Button
                  onClick={() => handleSave(selectedProvider)}
                  type="button"
                  size="sm"
                  className="mt-2"
                  disabled={saveMutation.isPending || deleteMutation.isPending}
                >
                  {saveMutation.isPending ? (
                    <RiLoader4Line
                      size={16}
                      className="animate-spin"
                    />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tool Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete your{" "}
              {TOOL_PROVIDERS.find((p) => p.id === providerToDelete)?.name} API
              key? The platform default key will be used instead (if available).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <RiLoader4Line
                  size={16}
                  className="mr-2 animate-spin"
                />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
