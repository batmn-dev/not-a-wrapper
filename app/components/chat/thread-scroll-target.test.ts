/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  alignThreadScrollTarget,
  followThreadScrollTarget,
  THREAD_TARGET_ALIGNMENT_EPSILON_PX,
  THREAD_TARGET_HEADER_GAP_PX,
  THREAD_TARGET_MIN_TRACKING_MS,
  THREAD_TARGET_STABLE_FRAME_COUNT,
  THREAD_TARGET_TIMEOUT_MS,
} from "./thread-scroll-target"

describe("thread message target alignment", () => {
  let root: HTMLDivElement
  let messageTop = 700
  let frame: FrameRequestCallback | null

  beforeEach(() => {
    messageTop = 700
    frame = null
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal("CSS", { escape: (value: string) => value })

    root = document.createElement("div")
    root.style.scrollPaddingTop = "52px"
    Object.assign(root, { scrollLeft: 4, scrollTop: 100 })
    root.getBoundingClientRect = () =>
      ({ top: 0, bottom: 600, height: 600 }) as DOMRect
    root.scrollTo = vi.fn()

    const turn = document.createElement("section")
    turn.dataset.turnIdContainer = "turn-1"
    const message = document.createElement("div")
    message.dataset.messageId = "message-1"
    message.getBoundingClientRect = () =>
      ({ top: messageTop, bottom: messageTop + 20, height: 20 }) as DOMRect
    message.scrollIntoView = vi.fn(() => {
      messageTop = 80
    })
    turn.append(message)
    root.append(turn)
    document.body.append(root)
  })

  afterEach(() => {
    root.remove()
    vi.unstubAllGlobals()
  })

  it("keeps the recovered convergence constants literal", () => {
    expect({
      headerGap: THREAD_TARGET_HEADER_GAP_PX,
      epsilon: THREAD_TARGET_ALIGNMENT_EPSILON_PX,
      minimumTracking: THREAD_TARGET_MIN_TRACKING_MS,
      stableFrames: THREAD_TARGET_STABLE_FRAME_COUNT,
      timeout: THREAD_TARGET_TIMEOUT_MS,
    }).toEqual({
      headerGap: 16,
      epsilon: 2,
      minimumTracking: 350,
      stableFrames: 3,
      timeout: 1500,
    })
  })

  it("aligns a message below scroll padding plus 16px and corrects deltas over 2px", () => {
    const message = root.querySelector<HTMLElement>("[data-message-id]")
    const result = alignThreadScrollTarget(
      root,
      { turnId: "turn-1", messageId: "message-1" },
      () => "smooth"
    )

    expect(message?.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    })
    expect(result).toEqual({
      target: "message",
      didScroll: true,
      alignmentDelta: 12,
    })
    expect(root.scrollTo).toHaveBeenCalledWith({ left: 4, top: 112 })
    expect(message?.style.scrollMarginTop).toBe("68px")

    frame?.(0)
    expect(message?.style.scrollMarginTop).toBe("")
  })

  it("keeps aligning a visible target when it moves during the stability window", () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    let now = 0
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId
      nextFrameId += 1
      callbacks.set(id, callback)
      return id
    })
    vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id))
    vi.spyOn(performance, "now").mockImplementation(() => now)

    const flushFrame = (timestamp: number) => {
      now = timestamp
      const pending = Array.from(callbacks.values())
      callbacks.clear()
      for (const callback of pending) callback(timestamp)
    }
    const message = root.querySelector<HTMLElement>("[data-message-id]")
    if (!message) throw new Error("Expected message target")
    message.scrollIntoView = vi.fn(() => {
      messageTop = 68
    })

    followThreadScrollTarget(
      root,
      { turnId: "turn-1", messageId: "message-1" },
      () => "smooth"
    )

    expect(message.scrollIntoView).toHaveBeenCalledOnce()
    flushFrame(16)
    expect(message.scrollIntoView).toHaveBeenCalledTimes(2)

    messageTop = 120
    flushFrame(32)
    expect(message.scrollIntoView).toHaveBeenCalledTimes(3)
    expect(messageTop).toBe(68)

    flushFrame(350)
    expect(message.scrollIntoView).toHaveBeenCalledTimes(4)
    flushFrame(366)
    expect(message.scrollIntoView).toHaveBeenCalledTimes(4)
  })
})
