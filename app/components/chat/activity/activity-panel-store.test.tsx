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
  ActivityPanelStoreProvider,
  createActivityPanelStore,
  useIsActivityPanelTurnOpen,
} from "./activity-panel-store"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("activity panel store — explicit-vs-default classification", () => {
  it("classifies against the CURRENT default at call time (stale-closure regression)", () => {
    const store = createActivityPanelStore()
    store.setDerivedActivity({ panelTurnId: "a1", defaultTurnId: "a1" })

    // Rows hold onto action references for their whole lifetime — capture once.
    const openTurn = store.openTurn

    // Clicking the default turn follows the default (no explicit selection).
    openTurn("a1")
    expect(store.getState().selectedTurnId).toBeUndefined()
    expect(store.getState().panelTurnId).toBe("a1")
    expect(store.getState().open).toBe(true)

    // A new generation moves the default. Under the old prop-threaded controls
    // object, a memo-blocked row kept an onOpenTurn closure over the OLD
    // default and misclassified this click as "follow the default".
    store.setDerivedActivity({
      panelTurnId: "pending",
      defaultTurnId: "pending",
    })

    openTurn("a1")
    // The click on a non-default turn is an explicit selection.
    expect(store.getState().selectedTurnId).toBe("a1")
    expect(store.getState().panelTurnId).toBe("a1")
  })

  it("clears the explicit selection on close and re-points at the default", () => {
    const store = createActivityPanelStore()
    store.setDerivedActivity({ panelTurnId: "a2", defaultTurnId: "a2" })
    store.openTurn("a1")
    expect(store.getState().selectedTurnId).toBe("a1")

    store.setOpen(false)
    expect(store.getState().open).toBe(false)
    expect(store.getState().selectedTurnId).toBeUndefined()
    expect(store.getState().panelTurnId).toBe("a2")
  })

  it("carries the one-shot section target through openTurn and clears it on consume, re-open, and close", () => {
    const store = createActivityPanelStore()
    store.setDerivedActivity({ panelTurnId: "a1", defaultTurnId: "a1" })

    // The sources badge opens with a section target.
    store.openTurn("a1", { section: "sources" })
    expect(store.getState().openSection).toBe("sources")

    // The panel consumes it after scrolling.
    store.clearOpenSection()
    expect(store.getState().openSection).toBeUndefined()

    // A section-less open (the activity trigger) clears a stale target.
    store.openTurn("a1", { section: "sources" })
    store.openTurn("a2")
    expect(store.getState().openSection).toBeUndefined()

    // Closing clears an unconsumed target.
    store.openTurn("a2", { section: "sources" })
    store.setOpen(false)
    expect(store.getState().openSection).toBeUndefined()
  })

  it("fires the wired onOpen side effect on every turn open", () => {
    const onOpen = vi.fn()
    const store = createActivityPanelStore()
    store.setOnOpen(onOpen)
    store.openTurn("a1")
    store.openTurn("a2")
    expect(onOpen).toHaveBeenCalledTimes(2)

    store.setOnOpen(null)
    store.openTurn("a1")
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it("clearStaleSelection drops only the named selection, never a newer one", () => {
    const store = createActivityPanelStore()
    store.setDerivedActivity({ panelTurnId: "a2", defaultTurnId: "a2" })
    store.openTurn("a1")
    expect(store.getState().selectedTurnId).toBe("a1")

    // The selected turn left the rendered path (branch switch): dropped, so
    // switching back later cannot resurrect it.
    store.clearStaleSelection("a1")
    expect(store.getState().selectedTurnId).toBeUndefined()
    expect(store.getState().open).toBe(true)

    // Call-time guard: a clear computed against a previous render must not
    // clobber a selection the user made after that render.
    store.openTurn("a3")
    store.clearStaleSelection("a1")
    expect(store.getState().selectedTurnId).toBe("a3")
  })
})

describe("activity panel store — row subscription precision", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    const rootToUnmount = root
    if (rootToUnmount) {
      act(() => {
        rootToUnmount.unmount()
      })
    }
    container?.remove()
    root = null
    container = null
  })

  it("re-renders only the rows whose panel-turn answer flips on a handoff", () => {
    // Commit counts observed via React.Profiler — a memo-bailed row commits
    // nothing, so its profiler stays quiet.
    const commits: Record<string, number> = { a1: 0, a2: 0, a3: 0 }
    const countCommit = (id: string) => {
      commits[id] += 1
    }

    function Row({ id }: { id: string }) {
      const isOpen = useIsActivityPanelTurnOpen(id)
      return <div data-testid={`row-${id}`} data-open={isOpen} />
    }
    const MemoRow = React.memo(Row)

    const store = createActivityPanelStore()
    store.setDerivedActivity({ panelTurnId: "a1", defaultTurnId: "a1" })
    store.setOpen(true)

    act(() => {
      root?.render(
        <ActivityPanelStoreProvider store={store}>
          {(["a1", "a2", "a3"] as const).map((id) => (
            <React.Profiler key={id} id={id} onRender={countCommit}>
              <MemoRow id={id} />
            </React.Profiler>
          ))}
        </ActivityPanelStoreProvider>
      )
    })

    expect(commits).toEqual({ a1: 1, a2: 1, a3: 1 })
    expect(
      container
        ?.querySelector('[data-testid="row-a1"]')
        ?.getAttribute("data-open")
    ).toBe("true")

    // Handoff a1 → a2: exactly the two flipped rows re-render; a3 does not.
    act(() => {
      store.openTurn("a2")
    })

    expect(commits).toEqual({ a1: 2, a2: 2, a3: 1 })
    expect(
      container
        ?.querySelector('[data-testid="row-a1"]')
        ?.getAttribute("data-open")
    ).toBe("false")
    expect(
      container
        ?.querySelector('[data-testid="row-a2"]')
        ?.getAttribute("data-open")
    ).toBe("true")
  })

  it("matches the panel turn by server message id", () => {
    function Row({ id, serverId }: { id: string; serverId?: string }) {
      const isOpen = useIsActivityPanelTurnOpen(id, serverId)
      return <div data-testid={`row-${id}`} data-open={isOpen} />
    }

    const store = createActivityPanelStore()
    store.setDerivedActivity({
      panelTurnId: "server-1",
      defaultTurnId: "server-1",
    })
    store.setOpen(true)

    act(() => {
      root?.render(
        <ActivityPanelStoreProvider store={store}>
          <Row id="client-1" serverId="server-1" />
        </ActivityPanelStoreProvider>
      )
    })

    expect(
      container
        ?.querySelector('[data-testid="row-client-1"]')
        ?.getAttribute("data-open")
    ).toBe("true")
  })
})
