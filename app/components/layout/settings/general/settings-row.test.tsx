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

  it("uses structural variants for first, middle, last, and single rows", () => {
    render(
      <>
        <SettingsFieldGroup data-testid="multiple">
          <SettingsField data-testid="first">
            <SettingsFieldSurface>First</SettingsFieldSurface>
          </SettingsField>
          <SettingsField data-testid="middle">
            <SettingsFieldSurface>Middle</SettingsFieldSurface>
          </SettingsField>
          <SettingsField data-testid="last">
            <SettingsFieldSurface>Last</SettingsFieldSurface>
          </SettingsField>
        </SettingsFieldGroup>
        <SettingsFieldGroup data-testid="single">
          <SettingsField data-testid="only">
            <SettingsFieldSurface>Only</SettingsFieldSurface>
          </SettingsField>
        </SettingsFieldGroup>
      </>
    )

    const group = container?.querySelector<HTMLElement>(
      '[data-testid="multiple"]'
    )
    const rows = [...(group?.children ?? [])] as HTMLElement[]
    const singleRow = container?.querySelector<HTMLElement>(
      '[data-testid="only"]'
    )

    expect(group?.className).toContain("overflow-hidden")
    expect(group?.className).toContain(
      "rounded-[calc(var(--radius)+var(--radius))]"
    )
    expect(group?.className).toContain("outline-border-default/80")
    expect(group?.className).toContain("bg-foreground/1")
    expect(rows).toHaveLength(3)
    expect(rows[0]?.className).toContain(
      "first:[&>[data-slot=settings-field-surface]]:rounded-t-2xl"
    )
    expect(rows[1]?.className).toContain("border-b")
    expect(rows[2]?.className).toContain("last:border-b-0")
    expect(singleRow?.className).toContain(
      "first:[&>[data-slot=settings-field-surface]]:rounded-t-2xl"
    )
    expect(singleRow?.className).toContain(
      "last:[&>[data-slot=settings-field-surface]]:rounded-b-2xl"
    )
  })

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
    expect(button?.className).toContain("data-[interactive]:hover:bg-row-hover")
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
