"use client"

import { useMemo, useRef, type RefCallback } from "react"

const DEFAULT_BOTTOM_THRESHOLD_PX = 24

type ActivityScrollFollowState = {
  turnKey: string | undefined
  viewport: HTMLDivElement | null
  content: HTMLElement | null
  pinned: boolean
  /** Overflow guard: the viewport overflowed before the latest growth. */
  wasOverflowing: boolean
  frameId: number | null
}

export type ActivityPanelScrollFollowOptions = {
  turnKey?: string
  /** Align to the end on attach (live default turn without a section target). */
  startAtEnd: boolean
  bottomThresholdPx?: number
}

export type ActivityPanelScrollFollow = {
  viewportRef: RefCallback<HTMLDivElement>
  contentRef: RefCallback<HTMLElement>
}

function createScrollFollowState(
  turnKey: string | undefined
): ActivityScrollFollowState {
  return {
    turnKey,
    viewport: null,
    content: null,
    pinned: false,
    wasOverflowing: false,
    frameId: null,
  }
}

function distanceFromEnd(viewport: HTMLElement): number {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
}

function isOverflowing(viewport: HTMLElement): boolean {
  return viewport.scrollHeight > viewport.clientHeight
}

function cancelScheduledAlignment(state: ActivityScrollFollowState): void {
  if (state.frameId === null) return
  cancelAnimationFrame(state.frameId)
  state.frameId = null
}

function scheduleEndAlignment(state: ActivityScrollFollowState): void {
  if (state.frameId !== null) return

  state.frameId = requestAnimationFrame(() => {
    state.frameId = null
    const viewport = state.viewport
    if (!viewport || !state.pinned) return

    viewport.scroll({
      top: viewport.scrollHeight,
      behavior: "instant",
    })
  })
}

export function useActivityPanelScrollFollow({
  turnKey,
  startAtEnd,
  bottomThresholdPx = DEFAULT_BOTTOM_THRESHOLD_PX,
}: ActivityPanelScrollFollowOptions): ActivityPanelScrollFollow {
  const stateRef = useRef<ActivityScrollFollowState | null>(null)

  return useMemo(() => {
    const readState = () => {
      if (stateRef.current?.turnKey === turnKey) return stateRef.current

      const state = createScrollFollowState(turnKey)
      stateRef.current = state
      return state
    }

    const viewportRef: RefCallback<HTMLDivElement> = (node) => {
      if (node === null) return

      const state = readState()
      state.viewport = node
      state.wasOverflowing = isOverflowing(node)
      state.pinned =
        startAtEnd || distanceFromEnd(node) <= bottomThresholdPx

      const onScroll = () => {
        if (state.viewport !== node) return
        state.pinned = distanceFromEnd(node) <= bottomThresholdPx
      }
      node.addEventListener("scroll", onScroll, { passive: true })

      if (startAtEnd) scheduleEndAlignment(state)

      return () => {
        node.removeEventListener("scroll", onScroll)
        if (state.viewport !== node) return
        cancelScheduledAlignment(state)
        state.viewport = null
      }
    }

    const contentRef: RefCallback<HTMLElement> = (node) => {
      if (node === null) return

      const state = readState()
      state.content = node
      const observer = new ResizeObserver(() => {
        if (state.content !== node) return
        const viewport = state.viewport
        if (!viewport) return

        if (state.pinned && state.wasOverflowing) {
          scheduleEndAlignment(state)
        }
        state.wasOverflowing = isOverflowing(viewport)
      })
      observer.observe(node)

      return () => {
        observer.disconnect()
        if (state.content === node) state.content = null
      }
    }

    return { viewportRef, contentRef }
  }, [bottomThresholdPx, startAtEnd, turnKey])
}
