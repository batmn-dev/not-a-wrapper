/** @vitest-environment jsdom */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  COMPOSER_SLIDE_TRANSITION_CLASS,
  runComposerSlideTransition,
} from "./composer-view-transition"

type StartViewTransition = (update: () => void) => {
  finished: Promise<unknown>
}

const globalCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8")

afterEach(() => {
  document.documentElement.classList.remove(COMPOSER_SLIDE_TRANSITION_CLASS)
  Reflect.deleteProperty(
    document as Document & { startViewTransition?: StartViewTransition },
    "startViewTransition"
  )
})

describe("runComposerSlideTransition", () => {
  it("ships dormant identities for each independently transitioning composer part", () => {
    expect(globalCss).toContain(".composer-parts-transition {")
    expect(globalCss).toContain("--vt-composer: none;")
    expect(globalCss).toContain(
      '[data-composer-surface="true"] {\n  view-transition-group: contain;'
    )
    expect(globalCss).toContain('[data-composer-transition-slot="leading"]')
    expect(globalCss).toContain("p.placeholder")
    expect(globalCss).toContain('[data-composer-transition-slot="trailing"]')
    expect(globalCss).toContain("::view-transition-group(composer-placeholder)")
  })

  it("runs the update immediately when view transitions are unavailable", () => {
    const update = vi.fn()

    runComposerSlideTransition(update)

    expect(update).toHaveBeenCalledOnce()
    expect(document.documentElement.classList).not.toContain(
      COMPOSER_SLIDE_TRANSITION_CLASS
    )
  })

  it("scopes transition variables until the browser transition settles", async () => {
    let finishTransition: (() => void) | undefined
    const finished = new Promise<void>((resolve) => {
      finishTransition = resolve
    })
    const startViewTransition = vi.fn((update: () => void) => {
      update()
      return { finished }
    })
    Object.assign(document, { startViewTransition })
    const update = vi.fn()

    runComposerSlideTransition(update)

    expect(startViewTransition).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledOnce()
    expect(document.documentElement.classList).toContain(
      COMPOSER_SLIDE_TRANSITION_CLASS
    )

    finishTransition?.()
    await finished
    await Promise.resolve()

    expect(document.documentElement.classList).not.toContain(
      COMPOSER_SLIDE_TRANSITION_CLASS
    )
  })
})
