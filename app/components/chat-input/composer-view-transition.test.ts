/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest"
import { runComposerSlideTransition } from "./composer-view-transition"

afterEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("first-send composer motion", () => {
  it("updates synchronously without browser animation support", () => {
    const update = vi.fn()
    runComposerSlideTransition(update)
    expect(update).toHaveBeenCalledOnce()
  })

  it("commits the send before animating the live composer", () => {
    document.body.innerHTML = '<form data-type="unified-composer"></form>'
    const form = document.querySelector("form")!
    vi.spyOn(form, "getBoundingClientRect")
      .mockReturnValueOnce({ top: 100 } as DOMRect)
      .mockReturnValueOnce({ top: 400 } as DOMRect)
    const events: string[] = []
    const animate = vi.fn(() => {
      events.push("animate")
    })
    Object.assign(form, { animate })

    runComposerSlideTransition(() => {
      events.push("send")
    })

    expect(events).toEqual(["send", "animate"])
    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translateY(-300px)" }, { transform: "translateY(0)" }],
      { duration: 500, easing: "ease-out" }
    )
  })

  it("skips layout and motion for reduced motion", () => {
    document.body.innerHTML = '<form data-type="unified-composer"></form>'
    const form = document.querySelector("form")!
    const rect = vi.spyOn(form, "getBoundingClientRect")
    const animate = vi.fn()
    Object.assign(form, { animate })
    vi.stubGlobal("matchMedia", () => ({ matches: true }))
    const update = vi.fn()

    runComposerSlideTransition(update)

    expect(update).toHaveBeenCalledOnce()
    expect(rect).not.toHaveBeenCalled()
    expect(animate).not.toHaveBeenCalled()
  })
})
