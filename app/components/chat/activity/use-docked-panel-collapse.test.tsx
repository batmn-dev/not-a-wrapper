/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import {
  DOCKED_PANEL_CLOSE_FALLBACK_MS,
  useDockedPanelCollapse,
} from "./use-docked-panel-collapse"

// `usePrefersReducedMotion` snapshots `matchMedia` at mount, so stub it before
// the first render of each case.
function stubReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

function Harness(props: {
  slotElement: HTMLElement | null
  dockedExpanded: boolean
  isBelowLg: boolean
  onResult: (result: {
    dockedPresent: boolean
  }) => void
}) {
  const { onResult, ...params } = props
  const { dockedPresent, onDockedContentRef } = useDockedPanelCollapse(params)
  onResult({
    dockedPresent,
  })
  return dockedPresent ? (
    <div ref={onDockedContentRef} data-testid="docked-content" />
  ) : null
}

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("useDockedPanelCollapse", () => {
  let container: HTMLDivElement | null = null
  let slot: HTMLDivElement | null = null
  let root: Root | null = null
  let latest: {
    dockedPresent: boolean
  } | null = null

  beforeEach(() => {
    latest = null
    container = document.createElement("div")
    slot = document.createElement("div")
    slot.dataset.state = "closed"
    document.body.append(container, slot)
    root = createRoot(container)
  })

  afterEach(() => {
    const r = root
    if (r) act(() => r.unmount())
    container?.remove()
    slot?.remove()
    root = null
    container = null
    slot = null
    latest = null
  })

  function render(dockedExpanded: boolean, isBelowLg = false) {
    act(() => {
      root?.render(
        <Harness
          slotElement={slot}
          dockedExpanded={dockedExpanded}
          isBelowLg={isBelowLg}
          onResult={(result) => {
            latest = result
          }}
        />
      )
    })
  }

  // With motion allowed the shell stays mounted (populated) through the close
  // until the layout slot's WIDTH transitionend, then unmounts. The persistent
  // slot carries the expanded/state attributes.
  it("defers unmount until the slot width transition ends", () => {
    stubReducedMotion(false)

    render(true)
    expect(latest?.dockedPresent).toBe(true)
    expect(slot?.hasAttribute("data-expanded")).toBe(true)
    expect(slot?.getAttribute("data-state")).toBe("open")

    render(false)
    expect(latest?.dockedPresent).toBe(true) // still mounted, collapsing
    expect(slot?.hasAttribute("data-expanded")).toBe(false)
    expect(slot?.getAttribute("data-state")).toBe("closed")
    expect(
      container?.querySelector('[data-testid="docked-content"]')
    ).toBeTruthy()

    act(() => {
      slot!.dispatchEvent(
        Object.assign(new Event("transitionend", { bubbles: true }), {
          propertyName: "width",
        })
      )
    })
    expect(latest?.dockedPresent).toBe(false)
  })

  // If the browser drops transitionend (interrupted resize/CSS change/already-0
  // width), the closing shell must not stay mounted forever.
  it("falls back when the slot width transition end is skipped", () => {
    vi.useFakeTimers()
    try {
      stubReducedMotion(false)

      render(true)
      expect(latest?.dockedPresent).toBe(true)

      render(false)
      expect(latest?.dockedPresent).toBe(true)
      expect(
        container?.querySelector('[data-testid="docked-content"]')
      ).toBeTruthy()

      act(() => {
        vi.advanceTimersByTime(DOCKED_PANEL_CLOSE_FALLBACK_MS - 1)
      })
      expect(latest?.dockedPresent).toBe(true)

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(latest?.dockedPresent).toBe(false)
      expect(
        container?.querySelector('[data-testid="docked-content"]')
      ).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  // Reduced motion has no width transition (and so no transitionend); the close
  // must unmount immediately, never entering the `closing` window.
  it("unmounts immediately under reduced motion", () => {
    stubReducedMotion(true)

    render(true)
    expect(latest?.dockedPresent).toBe(true)

    render(false)
    expect(latest?.dockedPresent).toBe(false)
  })
})
