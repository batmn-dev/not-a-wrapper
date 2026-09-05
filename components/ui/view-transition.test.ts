/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest"
import { runViewTransition } from "./view-transition"

type StartViewTransition = (
  update: (() => void) | { update: () => void; types: string[] }
) => {
  finished: Promise<unknown>
  ready?: Promise<unknown>
}

const transitionDocument = document as Document & {
  startViewTransition?: StartViewTransition
}

const transitionWindow = window as Window & {
  ViewTransitionTypeSet?: unknown
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.className = ""
  document.documentElement.removeAttribute("active-view-transition-type")
  Reflect.deleteProperty(transitionDocument, "startViewTransition")
  Reflect.deleteProperty(transitionWindow, "ViewTransitionTypeSet")
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  })
})

describe("runViewTransition", () => {
  it("hands off synchronously without taking snapshots when reduced motion is requested", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true }))
    )
    const snapshot = vi.fn()
    Reflect.set(transitionDocument, "startViewTransition", snapshot)
    const update = vi.fn()
    runViewTransition({ update, className: "surface-flip" })
    expect(update).toHaveBeenCalledOnce()
    expect(snapshot).not.toHaveBeenCalled()
    expect(document.documentElement.className).toBe("")
  })
  it("updates synchronously without transition state when unsupported or hidden", () => {
    const unsupportedUpdate = vi.fn()
    runViewTransition({ update: unsupportedUpdate, className: "surface-flip" })
    expect(unsupportedUpdate).toHaveBeenCalledOnce()
    expect(document.documentElement.className).toBe("")

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    })
    Reflect.set(transitionDocument, "startViewTransition", vi.fn())
    const hiddenUpdate = vi.fn()
    runViewTransition({ update: hiddenUpdate, className: "surface-flip" })
    expect(hiddenUpdate).toHaveBeenCalledOnce()
    expect(transitionDocument.startViewTransition).not.toHaveBeenCalled()
  })

  it("publishes typed lifecycle state until the transition finishes", async () => {
    let finish: (() => void) | undefined
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    transitionWindow.ViewTransitionTypeSet = class ViewTransitionTypeSet {}
    Reflect.set(
      transitionDocument,
      "startViewTransition",
      vi.fn((options) => {
        expect(typeof options).toBe("object")
        if (typeof options !== "function") options.update()
        return { finished, ready: Promise.resolve() }
      })
    )
    const update = vi.fn()

    runViewTransition({
      update,
      className: ["surface-flip", "surface-scoped"],
      types: ["composer", "header"],
    })

    expect(update).toHaveBeenCalledOnce()
    expect(document.documentElement.classList).toContain(
      "active-view-transition"
    )
    expect(document.documentElement.classList).toContain("surface-flip")
    expect(document.documentElement.classList).toContain("update-callback-done")
    expect(
      document.documentElement.getAttribute("active-view-transition-type")
    ).toBe("composer,header")

    finish?.()
    await finished
    await Promise.resolve()

    expect(document.documentElement.className).toBe("")
    expect(
      document.documentElement.hasAttribute("active-view-transition-type")
    ).toBe(false)
  })

  it("cleans up and runs an update once when startup throws", () => {
    Reflect.set(
      transitionDocument,
      "startViewTransition",
      vi.fn(() => {
        throw new Error("transition unavailable")
      })
    )
    const update = vi.fn()

    runViewTransition({ update, className: "surface-flip" })

    expect(update).toHaveBeenCalledOnce()
    expect(document.documentElement.className).toBe("")
  })
})
