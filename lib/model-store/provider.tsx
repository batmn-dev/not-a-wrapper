"use client"

import { api } from "@/convex/_generated/api"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { fetchClient } from "@/lib/fetch"
import { getModelInfo } from "@/lib/models"
import {
  resolveModelId,
  resolveModelIds,
} from "@/lib/models/model-id-migration"
import { ModelConfig } from "@/lib/models/types"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

type UserKeyStatus = {
  openrouter: boolean
  openai: boolean
  mistral: boolean
  google: boolean
  perplexity: boolean
  xai: boolean
  anthropic: boolean
  [key: string]: boolean // Allow for additional providers
}

const DEFAULT_KEY_STATUS: UserKeyStatus = {
  openrouter: false,
  openai: false,
  mistral: false,
  google: false,
  perplexity: false,
  xai: false,
  anthropic: false,
}

type ModelContextType = {
  models: ModelConfig[]
  userKeyStatus: UserKeyStatus
  favoriteModels: string[]
  lastUsedModel: string | null
  modelPrefsHydrated: boolean
  setLastUsedModel: (model: string) => void
  isLoading: boolean
  refreshFavoriteModelsSilent: () => Promise<void>
  refreshAll: () => Promise<void>
}

const ModelContext = createContext<ModelContextType | undefined>(undefined)

function isKnownModelId(modelId: string): boolean {
  return getModelInfo(resolveModelId(modelId)) !== undefined
}

function normalizeFavoriteModels(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const rawFavorites = value.filter(
    (entry): entry is string => typeof entry === "string"
  )

  const resolvedFavorites = resolveModelIds(rawFavorites)
  return resolvedFavorites.filter((entry) => isKnownModelId(entry))
}

export function ModelProvider({ children }: { children: React.ReactNode }) {
  const [rawModels, setRawModels] = useState<ModelConfig[]>([])
  // Keep first render deterministic between SSR and hydration.
  // Persisted browser values are applied after mount.
  const [favoriteModels, setFavoriteModels] = useState<string[]>([])
  const [lastUsedModel, setLastUsedModelState] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [modelPrefsHydrated, setModelPrefsHydrated] = useState(false)

  const setLastUsedModel = useCallback((model: string) => {
    const resolvedModel = resolveModelId(model)
    if (!isKnownModelId(resolvedModel)) return
    setLastUsedModelState(resolvedModel)
    try {
      localStorage.setItem("lastUsedModel", resolvedModel)
    } catch {}
  }, [])

  const { data: providers } = usePerUserQuery(api.userKeys.getProviderStatus)

  const userKeyStatus = useMemo<UserKeyStatus>(() => {
    if (!providers) return DEFAULT_KEY_STATUS

    return providers.reduce(
      (acc, provider) => {
        acc[provider] = true
        return acc
      },
      { ...DEFAULT_KEY_STATUS }
    )
  }, [providers])

  const models = useMemo<ModelConfig[]>(() => {
    return rawModels.map((model) => {
      if (model.accessible) return model

      const hasProviderKey = userKeyStatus[model.providerId] === true

      return {
        ...model,
        accessible: hasProviderKey,
      }
    })
  }, [rawModels, userKeyStatus])

  const fetchModels = useCallback(async () => {
    try {
      const response = await fetchClient("/api/models")
      if (response.ok) {
        const data = await response.json()
        setRawModels(data.models || [])
      }
    } catch (error) {
      console.error("Failed to fetch models:", error)
    }
  }, [])

  const fetchFavoriteModels = useCallback(async () => {
    try {
      const response = await fetchClient(
        "/api/user-preferences/favorite-models"
      )
      if (response.ok) {
        const data = await response.json()
        const normalized = normalizeFavoriteModels(data.favorite_models)
        setFavoriteModels(normalized)
        try {
          localStorage.setItem(
            "cachedFavoriteModels",
            JSON.stringify(normalized)
          )
        } catch {}
      }
    } catch (error) {
      console.error("Failed to fetch favorite models:", error)
      setFavoriteModels([])
    }
  }, [])

  const refreshFavoriteModelsSilent = useCallback(async () => {
    try {
      await fetchFavoriteModels()
    } catch (error) {
      console.error(
        "❌ ModelProvider: Failed to silently refresh favorite models:",
        error
      )
    }
  }, [fetchFavoriteModels])

  const refreshAll = useCallback(async () => {
    setIsLoading(true)
    try {
      // User key status is reactive via Convex, no need to fetch manually
      await Promise.all([fetchModels(), fetchFavoriteModels()])
    } finally {
      setIsLoading(false)
    }
  }, [fetchModels, fetchFavoriteModels])

  // Hydrate cached browser-only model preferences after mount.
  useEffect(() => {
    try {
      const cachedFavoriteModels = localStorage.getItem("cachedFavoriteModels")
      if (cachedFavoriteModels) {
        const parsed = JSON.parse(cachedFavoriteModels)
        const normalized = normalizeFavoriteModels(parsed)
        setFavoriteModels(normalized)

        const normalizedSerialized = JSON.stringify(normalized)
        if (normalizedSerialized !== cachedFavoriteModels) {
          localStorage.setItem("cachedFavoriteModels", normalizedSerialized)
        }
      }
    } catch {}

    try {
      const cachedLastUsedModel = localStorage.getItem("lastUsedModel")
      const resolvedLastUsedModel = cachedLastUsedModel
        ? resolveModelId(cachedLastUsedModel)
        : null

      if (resolvedLastUsedModel && isKnownModelId(resolvedLastUsedModel)) {
        setLastUsedModelState(resolvedLastUsedModel)
        if (resolvedLastUsedModel !== cachedLastUsedModel) {
          localStorage.setItem("lastUsedModel", resolvedLastUsedModel)
        }
      } else if (cachedLastUsedModel) {
        localStorage.removeItem("lastUsedModel")
      }
    } catch {}

    setModelPrefsHydrated(true)
  }, [])

  // Initial data fetch for non-Convex data
  useEffect(() => {
    const initFetch = async () => {
      setIsLoading(true)
      try {
        await Promise.all([fetchModels(), fetchFavoriteModels()])
      } finally {
        setIsLoading(false)
      }
    }
    initFetch()
  }, [fetchModels, fetchFavoriteModels])

  return (
    <ModelContext.Provider
      value={{
        models,
        userKeyStatus,
        favoriteModels,
        lastUsedModel,
        modelPrefsHydrated,
        setLastUsedModel,
        isLoading,
        refreshFavoriteModelsSilent,
        refreshAll,
      }}
    >
      {children}
    </ModelContext.Provider>
  )
}

// Custom hook to use the model context
export function useModel() {
  const context = useContext(ModelContext)
  if (context === undefined) {
    throw new Error("useModel must be used within a ModelProvider")
  }
  return context
}
