/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  resetThreadAnchorsForTest,
  restoreThreadAnchor,
  saveThreadAnchor,
  selectAnchorTurn,
} from "./thread-scroll-anchors"

function makeRoot(
  rootRect: { top: number; bottom: number },
  turns: Array<{ id: string; top: number; bottom: number }>
): HTMLElement {
  const root = document.createElement("div")
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rootRect as DOMRect)
  for (const t of turns) {
    const el = document.createElement("div")
    el.setAttribute("data-turn-id-container", t.id)
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      top: t.top,
      bottom: t.bottom,
    } as DOMRect)
    root.appendChild(el)
  }
  return root
}

describe("thread scroll anchors", () => {
  beforeEach(() => {
    resetThreadAnchorsForTest()
    vi.stubGlobal("CSS", { escape: (value: string) => value })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("prefers a crossing turn and excludes one ending at the top edge", () => {
    const root = makeRoot(
      { top: 100, bottom: 600 },
      [
        { id: "boundary", top: 0, bottom: 100 },
        { id: "a", top: 40, bottom: 140 },
        { id: "b", top: 140, bottom: 300 },
      ]
    )

    expect(selectAnchorTurn(root)).toBe(root.children[1])
  })

  it("falls back to the first turn starting inside the viewport", () => {
    const root = makeRoot(
      { top: 100, bottom: 600 },
      [
        { id: "a", top: 150, bottom: 300 },
        { id: "b", top: 300, bottom: 450 },
      ]
    )
    const fullyAbove = makeRoot(
      { top: 100, bottom: 600 },
      [{ id: "a", top: 0, bottom: 80 }]
    )
    const empty = makeRoot({ top: 100, bottom: 600 }, [])

    expect(selectAnchorTurn(root)).toBe(root.children[0])
    expect(selectAnchorTurn(fullyAbove)).toBeNull()
    expect(selectAnchorTurn(empty)).toBeNull()
  })

  it("restores the signed turn offset after content above changes height", () => {
    const savedRoot = makeRoot(
      { top: 100, bottom: 600 },
      [{ id: "m2", top: 60, bottom: 180 }]
    )
    saveThreadAnchor("chat-1", savedRoot)

    const restoredRoot = makeRoot(
      { top: 100, bottom: 600 },
      [{ id: "m2", top: 260, bottom: 400 }]
    )
    restoredRoot.scrollTop = 500

    expect(restoreThreadAnchor("chat-1", restoredRoot)).toBe(true)
    // 500 + (260 - (100 - 40)) = 700.
    expect(restoredRoot.scrollTop).toBe(700)
  })

  it("returns false without a saved chat or when its turn is absent", () => {
    const targetRoot = makeRoot(
      { top: 100, bottom: 600 },
      [{ id: "other", top: 80, bottom: 180 }]
    )
    targetRoot.scrollTop = 25

    expect(restoreThreadAnchor("unknown", targetRoot)).toBe(false)
    expect(targetRoot.scrollTop).toBe(25)

    const savedRoot = makeRoot(
      { top: 100, bottom: 600 },
      [{ id: "m2", top: 80, bottom: 180 }]
    )
    saveThreadAnchor("chat-1", savedRoot)
    targetRoot.scrollTop = 75

    expect(restoreThreadAnchor("chat-1", targetRoot)).toBe(false)
    expect(targetRoot.scrollTop).toBe(75)
  })

  it("clears a saved anchor when no turn is visible", () => {
    const visibleRoot = makeRoot(
      { top: 100, bottom: 600 },
      [{ id: "m2", top: 80, bottom: 180 }]
    )
    saveThreadAnchor("chat-1", visibleRoot)

    const allTurnsAboveRoot = makeRoot(
      { top: 100, bottom: 600 },
      [{ id: "m2", top: 0, bottom: 80 }]
    )
    saveThreadAnchor("chat-1", allTurnsAboveRoot)

    expect(restoreThreadAnchor("chat-1", visibleRoot)).toBe(false)
  })

  it("does not store a non-finite offset", () => {
    const root = document.createElement("div")
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 600,
    } as DOMRect)
    const turn = document.createElement("div")
    turn.setAttribute("data-turn-id-container", "m1")
    vi.spyOn(turn, "getBoundingClientRect")
      .mockReturnValueOnce({ top: 50, bottom: 150 } as DOMRect)
      .mockReturnValue({ top: Number.NaN, bottom: 150 } as DOMRect)
    root.appendChild(turn)

    saveThreadAnchor("chat-1", root)

    expect(restoreThreadAnchor("chat-1", root)).toBe(false)
  })
})
