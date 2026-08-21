"use client"

import { Icon } from "@/components/ui/icon"
import { useModel } from "@/lib/model-store/provider"
import type { LogicalModelView } from "@/lib/models/catalog"
import {
  compareModelsForProviderSection,
  compareProviderSections,
} from "@/lib/models/sort"
import { getVendorIcon } from "@/lib/provider-icons"
import { getVendor } from "@/lib/provider-identity"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import {
  RiAddLine,
  RiDraggable,
  RiStarLine,
  RiSubtractLine,
} from "@remixicon/react"
import { Reorder } from "framer-motion"
import { useMemo, useState } from "react"
import { useFavoriteModels } from "./use-favorite-models"

type FavoriteModelItem = LogicalModelView & {
  isFavorite: boolean
}

export function ModelsSettings() {
  const { models } = useModel()
  const { isModelHidden } = useUserPreferences()
  const [searchQuery, setSearchQuery] = useState("")

  const {
    favoriteModels: currentFavoriteModels,
    updateFavoriteModels,
    updateFavoriteModelsDebounced,
  } = useFavoriteModels()

  const favoriteModels: FavoriteModelItem[] = useMemo(() => {
    if (!currentFavoriteModels || !Array.isArray(currentFavoriteModels)) {
      return []
    }

    return currentFavoriteModels
      .map((id: string) => {
        const model = models.find((m) => m.id === id)
        if (!model || isModelHidden(model.id)) return null
        return { ...model, isFavorite: true }
      })
      .filter(Boolean) as FavoriteModelItem[]
  }, [currentFavoriteModels, models, isModelHidden])

  const availableModelsByProvider = useMemo(() => {
    if (!currentFavoriteModels || !Array.isArray(currentFavoriteModels)) {
      return {}
    }

    const availableModels = models
      .filter(
        (model) =>
          !currentFavoriteModels.includes(model.id) && !isModelHidden(model.id)
      )
      .filter((model) =>
        model.name.toLowerCase().includes(searchQuery.toLowerCase())
      )

    // Group by the model maker's vendor identity (ADR-0020); execution routes
    // never create vendor groups.
    const modelsByProvider = availableModels.reduce(
      (acc, model) => {
        const vendorKey = model.baseProviderId || "unknown"

        if (!acc[vendorKey]) {
          acc[vendorKey] = []
        }

        acc[vendorKey].push(model)

        return acc
      },
      {} as Record<string, typeof models>
    )

    for (const modelsGroup of Object.values(modelsByProvider)) {
      modelsGroup.sort(compareModelsForProviderSection)
    }

    return modelsByProvider
  }, [models, currentFavoriteModels, isModelHidden, searchQuery])

  const handleReorder = (newOrder: FavoriteModelItem[]) => {
    const newOrderIds = newOrder.map((item) => item.id)

    updateFavoriteModelsDebounced(newOrderIds)
  }

  const toggleFavorite = (modelId: string) => {
    if (!currentFavoriteModels || !Array.isArray(currentFavoriteModels)) {
      return
    }

    const isCurrentlyFavorite = currentFavoriteModels.includes(modelId)
    const newIds = isCurrentlyFavorite
      ? currentFavoriteModels.filter((id: string) => id !== modelId)
      : [...currentFavoriteModels, modelId]

    updateFavoriteModels(newIds)
  }

  const removeFavorite = (modelId: string) => {
    if (!currentFavoriteModels || !Array.isArray(currentFavoriteModels)) {
      return
    }

    const newIds = currentFavoriteModels.filter((id: string) => id !== modelId)

    updateFavoriteModels(newIds)
  }

  // Wrapped models can carry real vendor ids without registered icons;
  // getVendorIcon falls back to the OpenRouter icon.
  const getModelVendorIcon = (model: LogicalModelView) =>
    getVendorIcon(model.baseProviderId)

  return (
    <div className="space-y-6">
      <div>
        <h4 className="mb-3 text-sm font-medium text-balance">
          Your favorites ({favoriteModels.length})
        </h4>
        {favoriteModels.length > 0 ? (
          <Reorder.Group
            axis="y"
            values={favoriteModels}
            onReorder={handleReorder}
            className="space-y-2"
          >
            {favoriteModels.map((model) => {
              const VendorIcon = getModelVendorIcon(model)

              return (
                <Reorder.Item key={model.id} value={model} className="group">
                  <div className="border-border flex items-center gap-3 rounded-lg border bg-transparent p-3">
                    <div className="text-muted-foreground cursor-grab opacity-60 transition-opacity group-hover:opacity-100 active:cursor-grabbing">
                      <Icon icon={RiDraggable} slotSize={16} />
                    </div>

                    {VendorIcon && <VendorIcon className="size-5 shrink-0" />}

                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {model.name}
                      </span>
                      {model.description && (
                        <p className="text-muted-foreground mt-1 truncate text-xs">
                          {model.description}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => removeFavorite(model.id)}
                      type="button"
                      className="text-muted-foreground rounded-md border p-1 opacity-0 transition-all group-hover:opacity-100"
                      title="Remove from favorites"
                    >
                      <Icon icon={RiSubtractLine} slotSize={16} />
                    </button>
                  </div>
                </Reorder.Item>
              )
            })}
          </Reorder.Group>
        ) : (
          <div className="border-border text-muted-foreground flex h-32 items-center justify-center rounded-lg border-2 border-dashed">
            <div className="text-center">
              <Icon
                icon={RiStarLine}
                slotSize={32}
                className="mx-auto mb-2 opacity-50"
              />
              <p className="text-sm">No favorite models yet</p>
              <p className="text-xs">Add models from the list below</p>
            </div>
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-3 text-sm font-medium text-balance">
          Available models
        </h4>
        <p className="text-muted-foreground mb-4 text-sm text-pretty">
          Choose models to add to your favorites.
        </p>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-input-border bg-input-bg ring-offset-background placeholder:text-muted-foreground focus-visible:ring-focus-ring flex h-9 w-full rounded-md border px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div className="space-y-6 pb-6">
          {Object.entries(availableModelsByProvider)
            .sort(([a], [b]) => compareProviderSections(a, b))
            .map(([vendorKey, modelsGroup]) => {
              // Unregistered vendors keep their raw id as the group label.
              const vendor = getVendor(vendorKey)
              const GroupIcon = getVendorIcon(vendorKey)

              return (
                <div key={vendorKey} className="space-y-3">
                  <div className="flex items-center gap-2">
                    {vendor && <GroupIcon className="size-5" />}
                    <h4 className="font-medium text-balance">
                      {vendor?.name || vendorKey}
                    </h4>
                  </div>

                  <div className="space-y-2 pl-7">
                    {modelsGroup.map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center justify-between py-1"
                      >
                        <div className="flex flex-col">
                          <span className="text-sm">{model.name}</span>
                          {model.description && (
                            <span className="text-muted-foreground text-xs">
                              {model.description}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => toggleFavorite(model.id)}
                          type="button"
                          className="text-muted-foreground hover:text-foreground border-border rounded-md border p-1 transition-colors"
                          title="Add to favorites"
                        >
                          <Icon icon={RiAddLine} slotSize={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
        </div>

        {Object.keys(availableModelsByProvider).length === 0 && (
          <div className="text-muted-foreground py-8 text-center text-sm">
            {searchQuery
              ? `No models found matching "${searchQuery}"`
              : "No available models to add"}
          </div>
        )}
      </div>
    </div>
  )
}
