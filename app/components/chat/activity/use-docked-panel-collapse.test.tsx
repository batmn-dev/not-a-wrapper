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
  dockedExpanded: boolean
  isBelowLg: boolean
  onResult: (result: {
    dockedPresent: boolean
    dockedState: "open" | "closed"
  }) => void
}) {
  const { onResult, ...params } = props
  const {
    dockedPresent,
    dockedState,
    onDockedStageRef,
    onDockedTransitionEnd,
  } = useDockedPanelCollapse(params)
  onResult({
    dockedPresent,
    dockedState,
  })
  return dockedPresent ? (
    <div
      ref={onDockedStageRef}
      data-testid="stage-thread-flyout"
      data-state={dockedState}
      onTransitionEnd={onDockedTransitionEnd}
    />
  ) : null
}

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("useDockedPanelCollapse", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  let latest: {
    dockedPresent: boolean
    dockedState: "open" | "closed"
  } | null = null

  beforeEach(() => {
    latest = null
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    const r = root
    if (r) act(() => r.unmount())
    container?.remove()
    root = null
    container = null
    latest = null
  })

  function render(dockedExpanded: boolean, isBelowLg = false) {
    act(() => {
      root?.render(
        <Harness
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
  // until the portaled wrapper's WIDTH transitionend, then unmounts. The layout
  // slot stays passive; the wrapper carries `data-state`.
  it("defers unmount until the slot width transition ends", () => {
    stubReducedMotion(false)

    render(true)
    expect(latest?.dockedPresent).toBe(true)
    expect(latest?.dockedState).toBe("open")
    expect(
      container
        ?.querySelector('[data-testid="stage-thread-flyout"]')
        ?.getAttribute("data-state")
    ).toBe("open")

    render(false)
    expect(latest?.dockedPresent).toBe(true) // still mounted, collapsing
    const stage = container?.querySelector<HTMLElement>(
      '[data-testid="stage-thread-flyout"]'
    )
    expect(stage?.getAttribute("data-state")).toBe("closed")

    act(() => {
      stage!.dispatchEvent(
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
        container?.querySelector('[data-testid="stage-thread-flyout"]')
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
        container?.querySelector('[data-testid="stage-thread-flyout"]')
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
