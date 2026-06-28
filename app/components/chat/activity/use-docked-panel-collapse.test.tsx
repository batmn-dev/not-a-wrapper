/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { useDockedPanelCollapse } from "./use-docked-panel-collapse"

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
  onResult: (present: boolean) => void
}) {
  const { onResult, ...params } = props
  const { dockedPresent } = useDockedPanelCollapse(params)
  React.useEffect(() => {
    onResult(dockedPresent)
  })
  return null
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
  let present = false

  beforeEach(() => {
    present = false
    container = document.createElement("div")
    slot = document.createElement("div")
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
  })

  function render(dockedExpanded: boolean, isBelowLg = false) {
    act(() => {
      root?.render(
        <Harness
          slotElement={slot}
          dockedExpanded={dockedExpanded}
          isBelowLg={isBelowLg}
          onResult={(p) => {
            present = p
          }}
        />
      )
    })
  }

  // With motion allowed the shell stays mounted (populated) through the close
  // until the slot's WIDTH transitionend, then unmounts — and the slot's
  // imperative `data-expanded` tracks the open state.
  it("defers unmount until the slot width transition ends", () => {
    stubReducedMotion(false)

    render(true)
    expect(present).toBe(true)
    expect(slot!.hasAttribute("data-expanded")).toBe(true)

    render(false)
    expect(present).toBe(true) // still mounted, collapsing
    expect(slot!.hasAttribute("data-expanded")).toBe(false)

    act(() => {
      slot!.dispatchEvent(
        Object.assign(new Event("transitionend"), { propertyName: "width" })
      )
    })
    expect(present).toBe(false)
  })

  // Reduced motion has no width transition (and so no transitionend); the close
  // must unmount immediately, never entering the `closing` window.
  it("unmounts immediately under reduced motion", () => {
    stubReducedMotion(true)

    render(true)
    expect(present).toBe(true)

    render(false)
    expect(present).toBe(false)
  })
})
