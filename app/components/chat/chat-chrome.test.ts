import { describe, expect, it } from "vitest"
import { resolveChatChrome } from "./chat-chrome"

// The invariant this file pins (ADR-0017): the surface and the app header are
// decided together — no state may show a thread without the thread's header.
describe("resolveChatChrome", () => {
  it("home onboarding shows the app header", () => {
    expect(
      resolveChatChrome({ chatId: null, messageCount: 0, hasProject: false })
    ).toEqual({
      surface: "home-onboarding",
      appHeader: true,
      fixedHeader: "less-than-xl",
    })
  })

  it("project onboarding owns its chrome (no app header)", () => {
    expect(
      resolveChatChrome({ chatId: null, messageCount: 0, hasProject: true })
    ).toEqual({
      surface: "project-onboarding",
      appHeader: false,
      fixedHeader: "less-than-xl",
    })
  })

  it("an optimistic first send flips to a thread WITH the app header before any navigation", () => {
    // The pre-navigation send frame must bring the header with the thread on
    // both home and project surfaces.
    for (const hasProject of [false, true]) {
      expect(
        resolveChatChrome({ chatId: null, messageCount: 1, hasProject })
      ).toEqual({
        surface: "thread",
        appHeader: true,
        fixedHeader: "less-than-xl",
      })
    }
  })

  it("a mounted chat route is a thread with the app header, even before messages hydrate", () => {
    for (const hasProject of [false, true]) {
      expect(
        resolveChatChrome({ chatId: "chat-1", messageCount: 0, hasProject })
      ).toEqual({
        surface: "thread",
        appHeader: true,
        fixedHeader: "less-than-xl",
      })
      expect(
        resolveChatChrome({ chatId: "chat-1", messageCount: 4, hasProject })
      ).toEqual({
        surface: "thread",
        appHeader: true,
        fixedHeader: "less-than-xl",
      })
    }
  })

  it("a rejected first send rolls back to the owning onboarding surface", () => {
    expect(
      resolveChatChrome({ chatId: null, messageCount: 0, hasProject: true })
        .surface
    ).toBe("project-onboarding")
    expect(
      resolveChatChrome({ chatId: null, messageCount: 0, hasProject: false })
        .surface
    ).toBe("home-onboarding")
  })
})
