/** @vitest-environment jsdom */

import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { UsageSection } from "./usage-section"

vi.mock("@/convex/_generated/api", () => ({
  api: {
    usageAllowance: {
      getCurrentAllowance: "usageAllowance:getCurrentAllowance",
    },
  },
}))

vi.mock("@/lib/convex/use-per-user-query", () => ({
  usePerUserQuery: vi.fn(),
}))

const mockUsePerUserQuery = usePerUserQuery as unknown as ReturnType<
  typeof vi.fn
>

type Allowance = {
  planId: string
  periodStart: number
  periodEnd: number
  grantedCredits: number
  availableCredits: number
  reservedCredits: number
  spentCredits: number
}

type QueryResult = {
  data: Allowance | undefined
  isAuthReady: boolean
  isLoading: boolean
}

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("UsageSection", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
    vi.clearAllMocks()
  })

  function renderUsage(queryResult: QueryResult) {
    mockUsePerUserQuery.mockReturnValue(queryResult)
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => root?.render(<UsageSection />))
  }

  function getMeter() {
    return container?.querySelector<HTMLElement>(
      '[role="progressbar"][aria-label="Included allowance used this period"]'
    )
  }

  it("keeps unresolved allowance data indeterminate", () => {
    renderUsage({
      data: undefined,
      isAuthReady: true,
      isLoading: true,
    })

    const meter = getMeter()

    expect(container?.textContent).toContain("… remaining")
    expect(meter?.hasAttribute("data-indeterminate")).toBe(true)
    expect(meter?.hasAttribute("aria-valuenow")).toBe(false)
    expect(meter?.getAttribute("aria-valuetext")).toBe("indeterminate progress")
  })

  it("renders a resolved zero-credit allowance as zero percent remaining", () => {
    renderUsage({
      data: {
        planId: "free",
        periodStart: Date.UTC(2026, 7, 1),
        periodEnd: Date.UTC(2026, 8, 1),
        grantedCredits: 0,
        availableCredits: 0,
        reservedCredits: 0,
        spentCredits: 0,
      },
      isAuthReady: true,
      isLoading: false,
    })

    const meter = getMeter()

    expect(container?.textContent).toContain("0% remaining")
    expect(meter?.hasAttribute("data-indeterminate")).toBe(false)
    expect(meter?.getAttribute("aria-valuenow")).toBe("0")
  })

  it("fills only the used portion while labeling the remaining percentage", () => {
    renderUsage({
      data: {
        planId: "free",
        periodStart: Date.UTC(2026, 7, 1),
        periodEnd: Date.UTC(2026, 8, 1),
        grantedCredits: 1_000,
        availableCredits: 930,
        reservedCredits: 20,
        spentCredits: 50,
      },
      isAuthReady: true,
      isLoading: false,
    })

    const meter = getMeter()

    expect(container?.textContent).toContain("93% remaining")
    expect(container?.textContent).toContain("Resets")
    expect(meter?.getAttribute("aria-valuenow")).toBe("7")
  })
})
