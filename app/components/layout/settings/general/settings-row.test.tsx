/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  SettingsField,
  SettingsFieldControl,
  SettingsFieldGroup,
  SettingsFieldLabel,
  SettingsFieldSurface,
} from "./settings-row"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("settings field primitives", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  function render(node: React.ReactNode) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(node))
  }

  it("makes the complete interactive surface a native keyboard-focusable button", () => {
    const onClick = vi.fn()
    render(
      <SettingsFieldGroup>
        <SettingsField>
          <SettingsFieldSurface
            render={<button type="button" onClick={onClick} />}
            data-interactive
          >
            <SettingsFieldLabel>Interactive field</SettingsFieldLabel>
          </SettingsFieldSurface>
        </SettingsField>
      </SettingsFieldGroup>
    )

    const button = container?.querySelector<HTMLButtonElement>("button")
    act(() => button?.focus())
    expect(button).toBeInstanceOf(HTMLButtonElement)
    expect(document.activeElement).toBe(button)
    expect(button?.tabIndex).toBe(0)

    act(() => button?.click())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("does not bubble an embedded control click to a row action", () => {
    const onRowClick = vi.fn()
    const onControlClick = vi.fn()
    render(
      <SettingsFieldGroup>
        <SettingsField>
          <SettingsFieldSurface onClick={onRowClick} data-interactive>
            <SettingsFieldLabel>Controlled field</SettingsFieldLabel>
            <SettingsFieldControl>
              <button type="button" onClick={onControlClick}>
                Toggle
              </button>
            </SettingsFieldControl>
          </SettingsFieldSurface>
        </SettingsField>
      </SettingsFieldGroup>
    )

    const button = container?.querySelector<HTMLButtonElement>("button")
    act(() => button?.click())

    expect(onControlClick).toHaveBeenCalledTimes(1)
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it("keeps trailing content inside a native row button actionable", () => {
    const onRowClick = vi.fn()
    render(
      <SettingsFieldGroup>
        <SettingsField>
          <SettingsFieldSurface
            render={<button type="button" onClick={onRowClick} />}
            data-interactive
          >
            <SettingsFieldLabel>Profile picture</SettingsFieldLabel>
            <SettingsFieldControl>
              <span data-testid="avatar">Avatar</span>
            </SettingsFieldControl>
          </SettingsFieldSurface>
        </SettingsField>
      </SettingsFieldGroup>
    )

    const avatar = container?.querySelector<HTMLElement>(
      '[data-testid="avatar"]'
    )
    act(() => avatar?.click())

    expect(onRowClick).toHaveBeenCalledTimes(1)
  })
})
