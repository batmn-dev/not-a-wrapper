/**
 * Turn-anchor scroll restoration (ChatGPT parity — see
 * docs/chatgpt-scroll-restoration-source-research.md).
 *
 * A saved position is semantic: the top-visible turn's id plus its signed
 * pixel offset from the scroll root's top edge — never a raw scrollTop.
 * Restoration is a relative scrollTop correction from current geometry, so
 * height changes above the anchor (reflow, images, width changes) cannot
 * break it.
 *
 * The map is module-scoped and in-memory BY DESIGN: it survives client-side
 * navigation, and a full reload deliberately starts empty (the caller's
 * bottom fallback runs). No eviction, no serialization — matching the
 * audited ChatGPT behavior.
 */

type SavedThreadAnchor = {
  turnId: string
  offsetFromTopPx: number
}

const TURN_CONTAINER_SELECTOR = "[data-turn-id-container]"

const savedThreadAnchors = new Map<string, SavedThreadAnchor>()

/**
 * The first turn crossing the root's top edge, else the first turn starting
 * inside the viewport, else null. Uses the raw root rect top (not the sticky
 * header edge): save and restore share the same reference edge, so header
 * occlusion cancels out.
 *
 * Containers are flat siblings (conversation.tsx renders one per mapped
 * message; the pending-assistant placeholder has no container), so no
 * nested-duplicate filtering is needed.
 */
export function selectAnchorTurn(root: HTMLElement): HTMLElement | null {
  const rootRect = root.getBoundingClientRect()
  const turns = Array.from(
    root.querySelectorAll<HTMLElement>(TURN_CONTAINER_SELECTOR)
  )
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
  root.scrollTop += turn.getBoundingClientRect().top - desiredTurnTop
  return true
}

/** Test-only reset — the map is module state shared across tests. */
export function resetThreadAnchorsForTest(): void {
  savedThreadAnchors.clear()
}
