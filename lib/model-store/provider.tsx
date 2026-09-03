"use client"

import { api } from "@/convex/_generated/api"
import {
  writeComposerShellHintCookie,
  type ComposerShellHint,
} from "@/lib/composer-shell-hint"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { getVisibleLogicalModelViews } from "@/lib/models"
import {
  isLogicalModelId,
  normalizeFavoriteModelIds,
  resolveModelSelection,
  type LogicalModelView,
} from "@/lib/models/catalog"
import { readStoredEffortForModel } from "@/lib/reasoning-effort"
import { useUser } from "@/lib/user-store/provider"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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

const LAST_USED_MODEL_STORAGE_KEY = "lastUsedModel"
const LAST_USED_MODEL_CHANGE_EVENT = "last-used-model-change"

type ModelContextType = {
  /** One entry per visible logical model (ADR-0020). */
  models: LogicalModelView[]
  userKeyStatus: UserKeyStatus
  favoriteModels: string[]
  lastUsedModel: string | null
  /**
   * The server-render seed (ADR-0032), consulted only by hydration-time
   * server snapshots; after mount device memory is the live source.
   */
  shellHint: ComposerShellHint | null
  modelPrefsHydrated: boolean
  setLastUsedModel: (model: string) => void
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

/**
 * Device memory for the last explicitly selected model, read as a logical id
 * (a persisted legacy id resolves on read). Pure: the `useSyncExternalStore`
 * snapshot half; strings compare by value so no caching is needed.
 */
function readStoredLastUsedModel(): string | null {
  try {
    const cached = window.localStorage.getItem(LAST_USED_MODEL_STORAGE_KEY)
    const resolved = cached ? resolveModelSelection(cached).modelId : null
    return resolved && isLogicalModelId(resolved) ? resolved : null
  } catch {
    return null
  }
}

/** Cross-tab writes arrive via 'storage'; same-tab writes via the event. */
function subscribeToStoredLastUsedModel(onChange: () => void): () => void {
  window.addEventListener("storage", onChange)
  window.addEventListener(LAST_USED_MODEL_CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(LAST_USED_MODEL_CHANGE_EVENT, onChange)
  }
}

function subscribeToNothing(): () => void {
  return () => {}
}

function toShellHint(modelId: string | null): ComposerShellHint | null {
  if (!modelId) return null
  const effort = readStoredEffortForModel(modelId)
  return effort === undefined ? { modelId } : { modelId, effort }
}

export function ModelProvider({
  children,
  shellHint = null,
}: {
  children: React.ReactNode
  /** The request's Composer shell hint, read by the root layout. */
  shellHint?: ComposerShellHint | null
}) {
  // The catalog is static data already in the bundle (route records compiled
  // by lib/models/catalog.ts), so the server-rendered shell and the client
  // resolve the same list; `accessible` below folds in per-route key status.
  const [rawModels] = useState(() => getVisibleLogicalModelViews())
  // The seed is per request and fixed for the provider's lifetime.
  const seedRef = useRef(shellHint)
  const { user } = useUser()

  // Device memory is the live source; the shell hint is the server snapshot,
  // so the server render and hydration resolve the saved model and React
  // re-renders after hydration only if device memory genuinely differs.
  const lastUsedModel = useSyncExternalStore(
    subscribeToStoredLastUsedModel,
    readStoredLastUsedModel,
    useCallback(() => seedRef.current?.modelId ?? null, [])
  )
  const isHydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  )

  const favoriteModels = useMemo(
    () => normalizeFavoriteModels(user?.favorite_models),
    [user?.favorite_models]
  )
  const modelPrefsHydrated =
    isHydrated && (!user || user.favorite_models !== null)

  const setLastUsedModel = useCallback((model: string) => {
    const resolvedModel = resolveModelSelection(model).modelId
    if (!isLogicalModelId(resolvedModel)) return
    try {
      window.localStorage.setItem(LAST_USED_MODEL_STORAGE_KEY, resolvedModel)
    } catch {}
    window.dispatchEvent(new Event(LAST_USED_MODEL_CHANGE_EVENT))
    writeComposerShellHintCookie(toShellHint(resolvedModel))
  }, [])

  // The cookie mirror catches up once, at mount, when device memory drifted
  // from the seed this request was rendered with.
  useEffect(() => {
    const seed = seedRef.current
    const live = toShellHint(readStoredLastUsedModel())
    if (live?.modelId !== seed?.modelId || live?.effort !== seed?.effort) {
      writeComposerShellHintCookie(live)
    }
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
      // `accessible` from the catalog carries the platform half (free-model
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

  return (
    <ModelContext.Provider
      value={{
        models,
        userKeyStatus,
        favoriteModels,
        lastUsedModel,
        shellHint,
        modelPrefsHydrated,
        setLastUsedModel,
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
