"use client"

import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useMutation } from "convex/react"
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

export type PinnableProject = {
  _id: Id<"projects">
  pinned: boolean
}

type ProjectPinningState = {
  pinOverrides: Record<string, boolean>
  pendingProjectIds: Set<string>
}

type ProjectPinning = {
  isPinned: (project: PinnableProject) => boolean
  isPinPending: (projectId: Id<"projects">) => boolean
  togglePinned: (project: PinnableProject) => Promise<void>
}

const ProjectPinningContext = createContext<ProjectPinning | null>(null)

/** One optimistic pin state shared by every project surface in the app shell. */
export function ProjectPinningProvider({ children }: { children: ReactNode }) {
  const togglePinnedMutation = useMutation(api.projects.togglePinned)
  const [state, setState] = useState<ProjectPinningState>(() => ({
    pinOverrides: {},
    pendingProjectIds: new Set(),
  }))
  const stateRef = useRef(state)

  const updateState = useCallback(
    (update: (previous: ProjectPinningState) => ProjectPinningState) => {
      const next = update(stateRef.current)
      stateRef.current = next
      setState(next)
    },
    []
  )

  const isPinned = useCallback(
    (project: PinnableProject) =>
      state.pinOverrides[project._id] ?? project.pinned,
    [state.pinOverrides]
  )

  const isPinPending = useCallback(
    (projectId: Id<"projects">) => state.pendingProjectIds.has(projectId),
    [state.pendingProjectIds]
  )

  const togglePinned = useCallback(
    async (project: PinnableProject) => {
      const current = stateRef.current
      if (current.pendingProjectIds.has(project._id)) return

      const previousPinned = current.pinOverrides[project._id] ?? project.pinned
      const nextPinned = !previousPinned

      updateState((previous) => {
        const pendingProjectIds = new Set(previous.pendingProjectIds)
        pendingProjectIds.add(project._id)
        return {
          pinOverrides: {
            ...previous.pinOverrides,
            [project._id]: nextPinned,
          },
          pendingProjectIds,
        }
      })

      try {
        await togglePinnedMutation({
          projectId: project._id,
          pinned: nextPinned,
        })
      } catch {
        toast({ title: "Failed to update project pin", status: "error" })
      } finally {
        updateState((previous) => {
          const pinOverrides = { ...previous.pinOverrides }
          delete pinOverrides[project._id]
          const pendingProjectIds = new Set(previous.pendingProjectIds)
          pendingProjectIds.delete(project._id)
          return { pinOverrides, pendingProjectIds }
        })
      }
    },
    [togglePinnedMutation, updateState]
  )

  const value = useMemo(
    () => ({ isPinned, isPinPending, togglePinned }),
    [isPinned, isPinPending, togglePinned]
  )

  return createElement(ProjectPinningContext.Provider, { value }, children)
}

export function useProjectPinning(): ProjectPinning {
  const pinning = useContext(ProjectPinningContext)
  if (!pinning) {
    throw new Error(
      "useProjectPinning must be used within ProjectPinningProvider"
    )
  }
  return pinning
}
