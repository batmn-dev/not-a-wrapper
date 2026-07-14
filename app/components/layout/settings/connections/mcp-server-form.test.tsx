/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { McpServerForm } from "./mcp-server-form"

const formMocks = vi.hoisted(() => ({
  bulkApprove: vi.fn(async () => {}),
  fetchClient: vi.fn(),
}))

vi.mock("@/lib/fetch", () => ({ fetchClient: formMocks.fetchClient }))
vi.mock("convex/react", () => ({
  useMutation: () => formMocks.bulkApprove,
}))
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }))
vi.mock("@/components/ui/icon", () => ({ Icon: () => null }))
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}))
vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}))

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("McpServerForm test provenance", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    vi.clearAllMocks()
  })

  it("passes the edit server id to testing and refuses stale tool approvals", async () => {
    formMocks.fetchClient
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          toolCount: 1,
          toolNames: ["search"],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <McpServerForm
          open
          onOpenChange={vi.fn()}
          server={{
            _id: "server-1" as never,
            name: "Server",
            url: "https://a.example.com/mcp",
            transport: "http",
            authType: "bearer",
            encryptedAuthValue: "configured",
          }}
        />
      )
    })

    const findButton = (label: string) =>
      Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
        button.textContent?.includes(label)
      )

    await act(async () => {
      findButton("Test Connection")?.click()
    })

    const testCall = formMocks.fetchClient.mock.calls[0]
    expect(testCall?.[0]).toBe("/api/mcp-servers/test")
    expect(JSON.parse(String(testCall?.[1]?.body))).toMatchObject({
      serverId: "server-1",
      url: "https://a.example.com/mcp",
    })

    const urlInput = container?.querySelector<HTMLInputElement>("#mcp-url")
    await act(async () => {
      if (!urlInput) throw new Error("URL input missing")
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set
      valueSetter?.call(urlInput, "https://b.example.com/mcp")
      urlInput.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await act(async () => {
      findButton("Update")?.click()
    })

    expect(formMocks.bulkApprove).not.toHaveBeenCalled()
  })
})
