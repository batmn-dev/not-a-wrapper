/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("@/hooks/use-breakpoint", () => ({
  useBreakpoint: () => false,
}))

vi.mock("@/lib/user-store/provider", () => ({
  useUser: () => ({ user: { id: "test-user" } }),
}))

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
}))

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    isPending: false,
    isSuccess: false,
    mutate: vi.fn(),
  }),
}))

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}))

vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DrawerContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DrawerHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DrawerTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}))

let ProModelDialog: typeof import("./pro-dialog").ProModelDialog

describe("ProModelDialog", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(async () => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    ;({ ProModelDialog } = await import("./pro-dialog"))
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it("uses the shared multi-route provider names with dialog grammar", () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <ProModelDialog
          isOpen
          setIsOpen={vi.fn()}
          currentModel="claude-sonnet-5"
        />
      )
    })

    expect(container.textContent?.replace(/\s+/g, " ")).toContain(
      "This model runs with Anthropic or OpenRouter."
    )
  })
})
