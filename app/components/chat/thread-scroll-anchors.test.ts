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
  turns: Array<{
    id: string
    top: number
    bottom: number
    intersecting?: boolean
  }>
): HTMLElement {
  const root = document.createElement("div")
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rootRect as DOMRect)
  Object.defineProperties(root, {
    clientHeight: { configurable: true, value: 500 },
    scrollHeight: { configurable: true, value: 2_000 },
  })
  for (const t of turns) {
    const el = document.createElement("div")
    el.setAttribute("data-turn-id-container", t.id)
    if (t.intersecting !== undefined) {
      el.dataset.isIntersecting = String(t.intersecting)
    }
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
    const root = makeRoot({ top: 100, bottom: 600 }, [
      { id: "boundary", top: 0, bottom: 100 },
      { id: "a", top: 40, bottom: 140 },
      { id: "b", top: 140, bottom: 300 },
    ])

    expect(selectAnchorTurn(root)).toBe(root.children[1])
  })

  it("falls back to the first turn starting inside the viewport", () => {
    const root = makeRoot({ top: 100, bottom: 600 }, [
      { id: "a", top: 150, bottom: 300 },
      { id: "b", top: 300, bottom: 450 },
    ])
    const fullyAbove = makeRoot({ top: 100, bottom: 600 }, [
      { id: "a", top: 0, bottom: 80 },
    ])
    const empty = makeRoot({ top: 100, bottom: 600 }, [])

    expect(selectAnchorTurn(root)).toBe(root.children[0])
    expect(selectAnchorTurn(fullyAbove)).toBeNull()
    expect(selectAnchorTurn(empty)).toBeNull()
  })

  it("binary-searches the sibling turn wrappers carrying intersection state", () => {
    const root = makeRoot({ top: 100, bottom: 600 }, [
      { id: "above", top: 0, bottom: 100, intersecting: false },
      { id: "visible", top: 100, bottom: 240, intersecting: true },
      { id: "below", top: 240, bottom: 380, intersecting: false },
    ])

    expect(selectAnchorTurn(root)).toBe(root.children[1])
  })

  it("restores the signed turn offset after content above changes height", () => {
    const savedRoot = makeRoot({ top: 100, bottom: 600 }, [
      { id: "m2", top: 60, bottom: 180 },
    ])
    saveThreadAnchor("chat-1", savedRoot)

    const restoredRoot = makeRoot({ top: 100, bottom: 600 }, [
      { id: "m2", top: 260, bottom: 400 },
    ])
    restoredRoot.scrollTop = 500

    expect(restoreThreadAnchor("chat-1", restoredRoot)).toBe(true)
    // 500 + (260 - (100 - 40)) = 700.
    expect(restoredRoot.scrollTop).toBe(700)
  })

  it("returns false without a saved chat or when its turn is absent", () => {
    const targetRoot = makeRoot({ top: 100, bottom: 600 }, [
      { id: "other", top: 80, bottom: 180 },
    ])
    targetRoot.scrollTop = 25

    expect(restoreThreadAnchor("unknown", targetRoot)).toBe(false)
    expect(targetRoot.scrollTop).toBe(25)

    const savedRoot = makeRoot({ top: 100, bottom: 600 }, [
      { id: "m2", top: 80, bottom: 180 },
    ])
    saveThreadAnchor("chat-1", savedRoot)
    targetRoot.scrollTop = 75

    expect(restoreThreadAnchor("chat-1", targetRoot)).toBe(false)
    expect(targetRoot.scrollTop).toBe(75)
  })

  it("retains the last valid anchor through a transient empty layout", () => {
    const visibleRoot = makeRoot({ top: 100, bottom: 600 }, [
      { id: "m2", top: 80, bottom: 180 },
    ])
    saveThreadAnchor("chat-1", visibleRoot)

    const allTurnsAboveRoot = makeRoot({ top: 100, bottom: 600 }, [
      { id: "m2", top: 0, bottom: 80 },
    ])
    saveThreadAnchor("chat-1", allTurnsAboveRoot)

    const restoredRoot = makeRoot({ top: 100, bottom: 600 }, [
      { id: "m2", top: 180, bottom: 280 },
    ])
    restoredRoot.scrollTop = 300

    expect(restoreThreadAnchor("chat-1", restoredRoot)).toBe(true)
    // Saved offset was 20px; returning later restores from that settled anchor.
    expect(restoredRoot.scrollTop).toBe(400)
  })

  it("deletes the saved anchor when the thread is within two pixels of bottom", () => {
    const root = makeRoot({ top: 100, bottom: 600 }, [
      { id: "m2", top: 80, bottom: 180 },
    ])
    saveThreadAnchor("chat-1", root)
    root.scrollTop = 1_498

    saveThreadAnchor("chat-1", root)

    expect(restoreThreadAnchor("chat-1", root)).toBe(false)
  })

  it("does not replace a valid anchor with a non-finite measurement", () => {
    const settledRoot = makeRoot({ top: 100, bottom: 600 }, [
      { id: "settled", top: 80, bottom: 180 },
    ])
    saveThreadAnchor("chat-1", settledRoot)

    const root = document.createElement("div")
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 600,
    } as DOMRect)
    Object.defineProperties(root, {
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 2_000 },
    })
    const turn = document.createElement("div")
    turn.setAttribute("data-turn-id-container", "unstable")
    vi.spyOn(turn, "getBoundingClientRect")
      .mockReturnValueOnce({ top: 50, bottom: 150 } as DOMRect)
      .mockReturnValue({ top: Number.NaN, bottom: 150 } as DOMRect)
    root.appendChild(turn)

    saveThreadAnchor("chat-1", root)

    const restoredRoot = makeRoot({ top: 100, bottom: 600 }, [
      { id: "settled", top: 130, bottom: 230 },
    ])
    restoredRoot.scrollTop = 50
    expect(restoreThreadAnchor("chat-1", restoredRoot)).toBe(true)
    expect(restoredRoot.scrollTop).toBe(100)
  })

  it("uses the test reset as the only clear operation", () => {
    const root = makeRoot({ top: 100, bottom: 600 }, [
      { id: "m2", top: 80, bottom: 180 },
    ])
    saveThreadAnchor("chat-1", root)

    resetThreadAnchorsForTest()

    expect(restoreThreadAnchor("chat-1", root)).toBe(false)
  })
})
