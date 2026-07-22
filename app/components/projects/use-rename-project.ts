"use client"

import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useMutation } from "convex/react"
import { useCallback } from "react"

/**
 * The one rename-project persistence path: `projects.updateName` plus the
 * shared failure toast. Both rename surfaces (sidebar row inline rename and the
 * /projects directory row inline rename) commit through this hook so
 * error/pending semantics can't drift apart.
 */
export function useRenameProject() {
  const updateProjectName = useMutation(api.projects.updateName)

  return useCallback(
    async (projectId: Id<"projects">, name: string) => {
      try {
        await updateProjectName({ projectId, name })
      } catch (error) {
        toast({ title: "Failed to rename project", status: "error" })
        console.error("Failed to rename project:", error)
        throw error
      }
    },
    [updateProjectName]
  )
}
