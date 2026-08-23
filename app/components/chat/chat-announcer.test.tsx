/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ChatAnnouncerOutlet,
  ChatAnnouncerProvider,
  ChatStatusAnnouncer,
} from "./chat-announcer"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("ChatStatusAnnouncer durable presentation", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
  })

  function render(
    presentationState: React.ComponentProps<
      typeof ChatStatusAnnouncer
    >["presentationState"]
  ) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        <ChatAnnouncerProvider>
          <ChatAnnouncerOutlet />
          <ChatStatusAnnouncer presentationState={presentationState} />
        </ChatAnnouncerProvider>
      )
    })
  }

  it.each([
    ["local-streaming", "Generating response."],
    ["background-streaming", "Generating in background."],
    ["awaiting-approval", "Approval required."],
    ["stopping", "Stopping generation."],
    ["possibly-stale", "Generation status is temporarily unavailable."],
    ["stopped", "Generation stopped."],
  ] as const)(
    "announces %s through the existing polite region",
    (state, text) => {
      render(state)

      expect(
        document.querySelector('[role="status"][aria-live="polite"]')
          ?.textContent
      ).toBe(text)
      expect(
        document.querySelector('[role="alert"][aria-live="assertive"]')
          ?.textContent
      ).toBe("")
    }
  )

  it("announces durable failure through the existing assertive region", () => {
    render("failed")

    expect(
      document.querySelector('[role="status"][aria-live="polite"]')?.textContent
    ).toBe("")
    expect(
      document.querySelector('[role="alert"][aria-live="assertive"]')
        ?.textContent
    ).toBe("Generation failed.")
  })
})
