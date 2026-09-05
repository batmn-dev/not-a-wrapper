/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createComposerPaintController } from "./composer-paint"

let frameId = 0
let frames: Array<{ id: number; callback: FrameRequestCallback }> = []

function dispatchTimedEvent(
  element: HTMLElement,
  type: "keydown" | "beforeinput",
  options: { key?: string; inputType?: string; timeStamp: number }
) {
  const event =
    type === "keydown"
      ? new KeyboardEvent(type, { bubbles: true, key: options.key })
      : new InputEvent(type, { bubbles: true, inputType: options.inputType })
  Object.defineProperty(event, "timeStamp", { value: options.timeStamp })
  element.dispatchEvent(event)
}

function flushFrame(time: number) {
  const frame = frames.shift()
  frame?.callback(time)
}

describe("composer paint controller", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION = "true"
    frameId = 0
    frames = []
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const id = ++frameId
        frames.push({ id, callback })
        return id
      })
    )
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        frames = frames.filter((frame) => frame.id !== id)
      })
    )
    vi.spyOn(performance, "now").mockReturnValue(15)
  })

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("marks the next editor paint and the two-frame settled Composer paint", () => {
    const mark = vi.spyOn(performance, "mark")
    const editor = document.createElement("div")
    const controller = createComposerPaintController(editor)

    dispatchTimedEvent(editor, "keydown", { key: "a", timeStamp: 10 })
    dispatchTimedEvent(editor, "beforeinput", {
      inputType: "insertText",
      timeStamp: 12,
    })
    controller.onEditorUpdate()
    flushFrame(20)
    controller.onComposerUpdate()
    flushFrame(30)
    flushFrame(40)

    expect(mark).toHaveBeenCalledWith(
      "chat-perf:composer.keystroke_to_next_paint",
      { detail: { durationMs: 10 } }
    )
    expect(mark).toHaveBeenCalledWith(
      "chat-perf:composer.keystroke_to_settled_paint",
      { detail: { durationMs: 30 } }
    )
  })

  it("ignores unrelated input and cancels pending frames on disposal", () => {
    const mark = vi.spyOn(performance, "mark")
    const editor = document.createElement("div")
    const controller = createComposerPaintController(editor)

    dispatchTimedEvent(editor, "keydown", { key: "a", timeStamp: 10 })
    dispatchTimedEvent(editor, "beforeinput", {
      inputType: "historyUndo",
      timeStamp: 11,
    })
    controller.onEditorUpdate()
    controller.onComposerUpdate()
    expect(frames).toHaveLength(0)

    dispatchTimedEvent(editor, "keydown", { key: "b", timeStamp: 12 })
    controller.onEditorUpdate()
    expect(frames).toHaveLength(1)
    controller.dispose()
    expect(frames).toHaveLength(0)
    flushFrame(30)
    expect(mark).not.toHaveBeenCalled()
  })

  it("discards hidden intervals and stale inputs without editor transactions", () => {
    const mark = vi.spyOn(performance, "mark")
    const editor = document.createElement("div")
    const controller = createComposerPaintController(editor)
    dispatchTimedEvent(editor, "keydown", { key: "a", timeStamp: 10 })
    vi.spyOn(performance, "now").mockReturnValue(2500)
    controller.onComposerUpdate()
    expect(frames).toHaveLength(0)

    dispatchTimedEvent(editor, "keydown", { key: "b", timeStamp: 2510 })
    controller.onEditorUpdate()
    const delayed = frames[0]
    const visibility = vi.spyOn(document, "visibilityState", "get")
    visibility.mockReturnValue("hidden")
    document.dispatchEvent(new Event("visibilitychange"))
    expect(frames).toHaveLength(0)
    visibility.mockReturnValue("visible")
    delayed.callback(5000)
    expect(mark).not.toHaveBeenCalled()
    controller.dispose()
  })
})

describe("stalled composer input", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  it("retains a multi-second input delay instead of discarding the slowest observation", () => {
    process.env.NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION = "true"
    const mark = vi.spyOn(performance, "mark")
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    vi.spyOn(performance, "now").mockReturnValue(2500)
    const editor = document.createElement("div")
    const controller = createComposerPaintController(editor)
    dispatchTimedEvent(editor, "keydown", { key: "a", timeStamp: 10 })
    controller.onEditorUpdate()
    callbacks.shift()?.(2510)
    expect(mark).toHaveBeenCalledWith(
      "chat-perf:composer.keystroke_to_next_paint",
      { detail: { durationMs: 2500 } }
    )
    controller.dispose()
  })
})
