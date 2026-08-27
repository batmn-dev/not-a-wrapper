/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { announce, resetAriaNotify } from "./aria-notify"
import {
  ChatAnnouncerOutlet,
  ChatAnnouncerProvider,
  ChatStatusAnnouncer,
} from "./chat-announcer"

const responsive = vi.hoisted(() => ({ isMobile: false }))

vi.mock("@/hooks/use-breakpoint", () => ({
  useBreakpoint: () => responsive.isMobile,
}))

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

const politeText = () =>
  document.querySelector('[role="status"][aria-live="polite"]')?.textContent
const assertiveText = () =>
  document.querySelector('[role="alert"][aria-live="assertive"]')?.textContent

describe("ChatStatusAnnouncer durable presentation", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
    responsive.isMobile = false
    resetAriaNotify()
  })

  async function render(
    presentationState: React.ComponentProps<
      typeof ChatStatusAnnouncer
    >["presentationState"],
    props: Partial<React.ComponentProps<typeof ChatStatusAnnouncer>> = {}
  ) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    // Async act flushes the registry's deferred (microtask) enqueue.
    await act(async () => {
      root?.render(
        <ChatAnnouncerProvider>
          <ChatAnnouncerOutlet />
          <ChatStatusAnnouncer
            presentationState={presentationState}
            {...props}
          />
        </ChatAnnouncerProvider>
      )
    })
  }

  it.each([
    ["local-streaming", "Thinking"],
    ["background-streaming", "Generating in background."],
    ["awaiting-approval", "Approval required."],
    ["stopping", "Stopping generation."],
    ["possibly-stale", "Generation status is temporarily unavailable."],
    ["stopped", "Generation stopped."],
  ] as const)(
    "announces %s through the existing polite region",
    async (state, text) => {
      await render(state)

      expect(politeText()).toBe(text)
      expect(assertiveText()).toBe("")
    }
  )

  it("announces durable failure through the existing assertive region", async () => {
    await render("failed")

    expect(politeText()).toBe("")
    expect(assertiveText()).toBe("Generation failed.")
  })

  it("announces completion on desktop and leaves mobile focus ownership to the turn", async () => {
    await render("completed", { completionAvailable: true })
    expect(politeText()).toBe("Response complete")

    act(() => root?.unmount())
    container?.remove()
    resetAriaNotify()
    responsive.isMobile = true
    await render("completed", { completionAvailable: true })
    expect(politeText()).toBe("")
  })
})

describe("ChatStatusAnnouncer transitions", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
    resetAriaNotify()
  })

  function renderAnnouncer(
    presentationState: React.ComponentProps<
      typeof ChatStatusAnnouncer
    >["presentationState"]
  ) {
    root?.render(
      <>
        <ChatAnnouncerOutlet />
        <ChatStatusAnnouncer
          presentationState={presentationState}
          completionAvailable={presentationState === "completed"}
          turnId="a"
        />
      </>
    )
  }

  async function mountAnnouncer(
    presentationState: React.ComponentProps<
      typeof ChatStatusAnnouncer
    >["presentationState"]
  ) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      renderAnnouncer(presentationState)
    })
  }

  it("drops a queued durable status when the turn completes", async () => {
    vi.useFakeTimers()
    try {
      await act(async () => {
        announce("Other announcement", { id: "other" })
      })
      await mountAnnouncer("background-streaming")
      expect(politeText()).toBe("Other announcement")

      await act(async () => {
        renderAnnouncer("completed")
      })
      expect(politeText()).toBe("Other announcement")

      await act(async () => {
        vi.advanceTimersByTime(500)
      })
      expect(politeText()).toBe("Response complete")

      await act(async () => {
        vi.advanceTimersByTime(500)
      })
      expect(politeText()).toBe("")
    } finally {
      vi.useRealTimers()
    }
  })
})
