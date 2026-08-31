import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import { useModel } from "@/lib/model-store/provider"
import type { OptimisticLocalStore } from "convex/browser"
import { useMutation } from "convex/react"
import { useCallback, useMemo } from "react"

function applyFavoriteModelsOptimistically(
  localStore: OptimisticLocalStore,
  { favoriteModels }: { favoriteModels: string[] }
) {
  const currentUser = localStore.getQuery(api.users.getCurrent, {})
  if (!currentUser) return

  localStore.setQuery(
    api.users.getCurrent,
    {},
    {
      ...currentUser,
      favoriteModels,
    }
  )
}

export function useFavoriteModels() {
  const { favoriteModels, modelPrefsHydrated } = useModel()
  const favoriteModelsMutation = useMutation(api.users.updateFavoriteModels)
  const updateFavoriteModelsMutation = useMemo(
    () =>
      favoriteModelsMutation.withOptimisticUpdate(
        applyFavoriteModelsOptimistically
      ),
    [favoriteModelsMutation]
  )

  const updateFavoriteModels = useCallback(
    async (nextFavoriteModels: string[]) => {
      try {
        await updateFavoriteModelsMutation({
          favoriteModels: nextFavoriteModels,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Please try again."
        console.error("Failed to save favorite models:", error)
        toast({
          title: "Failed to save pinned models",
          description: message,
        })
      }
    },
    [updateFavoriteModelsMutation]
  )

  return {
    favoriteModels,
    updateFavoriteModels,
    isLoading: !modelPrefsHydrated,
  }
}
