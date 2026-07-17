// @vitest-environment jsdom

import { act, createElement } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CHAT_ORGANIZATION_STORAGE_KEY,
  DEFAULT_CHAT_ORGANIZATION,
  parseChatOrganization,
  setStoredChatOrganization,
  useChatOrganization,
} from "./chat-organization"

function PreferenceProbe() {
  const [organization, , isHydrated] = useChatOrganization()
  return createElement("span", null, `${organization}:${isHydrated}`)
}

describe("chat organization preference", () => {
  beforeAll(() => {
    let values = new Map<string, string>()
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() {
          return values.size
        },
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
        reset: () => {
          values = new Map()
        },
      },
    })
  })

  beforeEach(() => localStorage.clear())

  it("defaults invalid or absent values to By project", () => {
    expect(parseChatOrganization(null)).toBe(DEFAULT_CHAT_ORGANIZATION)
    expect(parseChatOrganization("unexpected")).toBe("by-project")
  })

  it("restores In one list", () => {
    expect(parseChatOrganization("one-list")).toBe("one-list")
  })

  it("persists a change and notifies same-document subscribers", () => {
    const listener = vi.fn()
    window.addEventListener("storage", listener)

    setStoredChatOrganization("one-list")

    expect(localStorage.getItem(CHAT_ORGANIZATION_STORAGE_KEY)).toBe("one-list")
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener("storage", listener)
  })

  it("keeps the server hierarchy stable until the stored preference hydrates", async () => {
    localStorage.setItem(CHAT_ORGANIZATION_STORAGE_KEY, "one-list")
    const container = document.createElement("div")
    container.innerHTML = renderToString(createElement(PreferenceProbe))
    document.body.append(container)

    expect(container.textContent).toBe("by-project:false")

    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, createElement(PreferenceProbe))
    })

    expect(container.textContent).toBe("one-list:true")
    await act(async () => root?.unmount())
    container.remove()
  })
})
