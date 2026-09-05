/**
 * Turn-anchor scroll restoration.
 *
 * A saved position is semantic: the top-visible turn's id plus its signed
 * pixel offset from the scroll root's top edge — never a raw scrollTop.
 * Restoration is a relative scrollTop correction from current geometry, so
 * height changes above the anchor (reflow, images, width changes) cannot
 * break it.
 *
 * The map is module-scoped and in-memory BY DESIGN: it survives client-side
 * navigation, and a full reload deliberately starts empty (the caller's
 * bottom fallback runs). No eviction and no serialization.
 */

import { noteChatProgrammaticScroll } from "@/lib/observability/chat-ui-events"

type SavedThreadAnchor = {
  turnId: string
  offsetFromTopPx: number
}

const TURN_CONTAINER_SELECTOR = "[data-turn-id-container]"
const INTERSECTING_TURN_SELECTOR =
  "[data-turn-id-container][data-is-intersecting]"
const BOTTOM_EPSILON_PX = 2

const savedThreadAnchors = new Map<string, SavedThreadAnchor>()

/**
 * The first turn crossing the root's top edge, else the first turn starting
 * inside the viewport, else null. Uses the raw root rect top (not the sticky
 * header edge): save and restore share the same reference edge, so header
 * occlusion cancels out.
 *
 * The turn-list owner and the section both expose the turn id. Keep only the
 * outer owner, exactly as the runtime anchor path does, so one turn contributes
 * one geometry candidate.
 */
export function selectAnchorTurn(root: HTMLElement): HTMLElement | null {
  const rootRect = root.getBoundingClientRect()
  const intersectingTurns = Array.from(
    root.querySelectorAll<HTMLElement>(INTERSECTING_TURN_SELECTOR)
  )
  if (
    intersectingTurns.length > 0 &&
    intersectingTurns.every(
      (turn) => turn.parentElement === intersectingTurns[0]?.parentElement
    )
  ) {
    let start = 0
    let end = intersectingTurns.length
    while (start < end) {
      const middle = (start + end) >>> 1
      const turn = intersectingTurns[middle]
      if (turn && turn.getBoundingClientRect().bottom <= rootRect.top) {
        start = middle + 1
      } else {
        end = middle
      }
    }
    const candidate = intersectingTurns[start]
    return candidate && candidate.getBoundingClientRect().top < rootRect.bottom
      ? candidate
      : null
  }

  const turns = Array.from(
    root.querySelectorAll<HTMLElement>(TURN_CONTAINER_SELECTOR)
  ).filter((turn) => {
    const turnId = turn.dataset.turnIdContainer
    return turnId
      ? turn.parentElement?.closest<HTMLElement>(TURN_CONTAINER_SELECTOR)
          ?.dataset.turnIdContainer !== turnId
      : false
  })
  return (
    turns.find((turn) => {
      const rect = turn.getBoundingClientRect()
      return rect.top <= rootRect.top && rect.bottom > rootRect.top
    }) ??
    turns.find((turn) => {
      const rect = turn.getBoundingClientRect()
      return rect.top >= rootRect.top && rect.top < rootRect.bottom
    }) ??
    null
  )
}

export function saveThreadAnchor(chatId: string, root: HTMLElement): void {
  if (
    root.scrollTop + root.clientHeight >=
    root.scrollHeight - BOTTOM_EPSILON_PX
  ) {
    savedThreadAnchors.delete(chatId)
    return
  }

  const turn = selectAnchorTurn(root)
  const turnId = turn?.dataset.turnIdContainer
  if (!turn || !turnId) return
  const offsetFromTopPx =
    root.getBoundingClientRect().top - turn.getBoundingClientRect().top
  if (!Number.isFinite(offsetFromTopPx)) return
  savedThreadAnchors.set(chatId, { turnId, offsetFromTopPx })
}

/** Relative correction — never assigns a stored raw scrollTop. */
export function restoreThreadAnchor(
  chatId: string,
  root: HTMLElement
): boolean {
  const saved = savedThreadAnchors.get(chatId)
  if (!saved) return false
  const turn = root.querySelector<HTMLElement>(
    `[data-turn-id-container="${CSS.escape(saved.turnId)}"]`
  )
  if (!turn) return false
  const rootTop = root.getBoundingClientRect().top
  const desiredTurnTop = rootTop - saved.offsetFromTopPx
  noteChatProgrammaticScroll(root)
  root.scrollTop += turn.getBoundingClientRect().top - desiredTurnTop
  return true
}

/** Test-only reset — the map is module state shared across tests. */
export function resetThreadAnchorsForTest(): void {
  savedThreadAnchors.clear()
}
