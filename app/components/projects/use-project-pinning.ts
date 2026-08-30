"use client"

import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useMutation } from "convex/react"
import { useCallback, useState } from "react"

export type PinnableProject = {
  _id: Id<"projects">
  pinned: boolean
}

/**
 * Shared optimistic pinning state for each project-list surface. Overrides are
 * retained until the component unmounts so the UI never waits for the Convex
 * subscription round trip; a failed write restores the exact prior value.
 */
export function useProjectPinning() {
  const togglePinnedMutation = useMutation(api.projects.togglePinned)
  const [pinOverrides, setPinOverrides] = useState<Record<string, boolean>>({})
  const [pendingProjectIds, setPendingProjectIds] = useState<Set<string>>(
    () => new Set()
  )

  const isPinned = useCallback(
    (project: PinnableProject) => pinOverrides[project._id] ?? project.pinned,
    [pinOverrides]
  )

  const isPinPending = useCallback(
    (projectId: Id<"projects">) => pendingProjectIds.has(projectId),
    [pendingProjectIds]
  )

  const togglePinned = useCallback(
    async (project: PinnableProject) => {
      if (pendingProjectIds.has(project._id)) return

      const previousPinned = pinOverrides[project._id] ?? project.pinned
      const nextPinned = !previousPinned

      setPinOverrides((previous) => ({
        ...previous,
        [project._id]: nextPinned,
      }))
      setPendingProjectIds((previous) => {
        const next = new Set(previous)
        next.add(project._id)
        return next
      })

      try {
        await togglePinnedMutation({
          projectId: project._id,
          pinned: nextPinned,
        })
      } catch {
        setPinOverrides((previous) => ({
          ...previous,
          [project._id]: previousPinned,
        }))
        toast({ title: "Failed to update project pin", status: "error" })
      } finally {
        setPendingProjectIds((previous) => {
          const next = new Set(previous)
          next.delete(project._id)
          return next
        })
      }
    },
    [pendingProjectIds, pinOverrides, togglePinnedMutation]
  )

  return { isPinned, isPinPending, togglePinned }
}
