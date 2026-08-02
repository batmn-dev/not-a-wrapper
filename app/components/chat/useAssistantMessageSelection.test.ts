import { describe, expect, it } from "vitest"
import { constrainSelectionPosition } from "./useAssistantMessageSelection"

const selectionRect = {
  left: 100,
  right: 500,
  top: 200,
  bottom: 300,
} as DOMRect

describe("constrainSelectionPosition", () => {
  it("keeps the mouse position when it is inside the selection", () => {
    expect(
      constrainSelectionPosition(selectionRect, { x: 320, y: 240 })
    ).toEqual({ x: 320, y: 240 })
  })

  it("constrains the mouse position to the selection bounds", () => {
    expect(
      constrainSelectionPosition(selectionRect, { x: 700, y: 120 })
    ).toEqual({ x: 500, y: 200 })
  })
})
