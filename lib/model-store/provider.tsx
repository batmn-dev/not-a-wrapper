"use client"

import { api } from "@/convex/_generated/api"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { fetchClient } from "@/lib/fetch"
import {
  isLogicalModelId,
  normalizeFavoriteModelIds,
  resolveModelSelection,
  type LogicalModelView,
} from "@/lib/models/catalog"
import { useUser } from "@/lib/user-store/provider"
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
  /** One entry per visible logical model (ADR-0020). */
  models: LogicalModelView[]
  userKeyStatus: UserKeyStatus
  favoriteModels: string[]
  lastUsedModel: string | null
  modelPrefsHydrated: boolean
  setLastUsedModel: (model: string) => void
  isLoading: boolean
  refreshAll: () => Promise<void>
}

const ModelContext = createContext<ModelContextType | undefined>(undefined)

function normalizeFavoriteModels(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const rawFavorites = value.filter(
    (entry): entry is string => typeof entry === "string"
  )

  // Logical normalization (ADR-0020): aliases, successions, and old routed
  // ids collapse to logical ids, deduplicated while preserving user order.
  return normalizeFavoriteModelIds(rawFavorites)
}

export function ModelProvider({ children }: { children: React.ReactNode }) {
  const [rawModels, setRawModels] = useState<LogicalModelView[]>([])
  const [lastUsedModel, setLastUsedModelState] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [lastUsedModelHydrated, setLastUsedModelHydrated] = useState(false)
  const { user } = useUser()

  const favoriteModels = useMemo(
    () => normalizeFavoriteModels(user?.favorite_models),
    [user?.favorite_models]
  )
  const modelPrefsHydrated =
    lastUsedModelHydrated && (!user || user.favorite_models !== null)

  const setLastUsedModel = useCallback((model: string) => {
    const resolvedModel = resolveModelSelection(model).modelId
    if (!isLogicalModelId(resolvedModel)) return
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

  const models = useMemo<LogicalModelView[]>(() => {
    return rawModels.map((model) => {
      // `accessible` from the server carries the platform half (free-model
      // entitlement); a key for ANY of the model's routes unlocks the rest.
      // Presentation-only — the server route resolver re-derives eligibility
      // and the actual credential at admission.
      if (model.accessible) return model

      const hasRouteKey = model.routes.some(
        (route) => userKeyStatus[route.providerId] === true
      )

      return {
        ...model,
        accessible: hasRouteKey,
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

  const refreshAll = useCallback(async () => {
    setIsLoading(true)
    try {
      // User key status and favorites are reactive via Convex.
      await fetchModels()
    } finally {
      setIsLoading(false)
    }
  }, [fetchModels])

  // Hydrate the browser-only last-used model after mount.
  useEffect(() => {
    try {
      const cachedLastUsedModel = localStorage.getItem("lastUsedModel")
      const resolvedLastUsedModel = cachedLastUsedModel
        ? resolveModelSelection(cachedLastUsedModel).modelId
        : null

      if (resolvedLastUsedModel && isLogicalModelId(resolvedLastUsedModel)) {
        setLastUsedModelState(resolvedLastUsedModel)
        if (resolvedLastUsedModel !== cachedLastUsedModel) {
          localStorage.setItem("lastUsedModel", resolvedLastUsedModel)
        }
      } else if (cachedLastUsedModel) {
        localStorage.removeItem("lastUsedModel")
      }
    } catch {}

    setLastUsedModelHydrated(true)
  }, [])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

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
        refreshAll,
      }}
    >
      {children}
    </ModelContext.Provider>
  )
}

export function useModel() {
  const context = useContext(ModelContext)
  if (context === undefined) {
    throw new Error("useModel must be used within a ModelProvider")
  }
  return context
}
