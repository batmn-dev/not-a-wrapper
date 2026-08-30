/** @vitest-environment jsdom */
import type { Id } from "@/convex/_generated/dataModel"
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
  ProjectPinningProvider,
  useProjectPinning,
} from "./use-project-pinning"

const mocks = vi.hoisted(() => ({ togglePinned: vi.fn() }))

vi.mock("convex/react", () => ({
  useMutation: () => mocks.togglePinned,
}))

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

const project = {
  _id: "project-shared-pinning" as Id<"projects">,
  pinned: false,
}

function PinProbe({ label }: { label: string }) {
  const { isPinned, isPinPending, togglePinned } = useProjectPinning()

  return (
    <button type="button" onClick={() => void togglePinned(project)}>
      {label}:{isPinned(project) ? "pinned" : "unpinned"}:
      {isPinPending(project._id) ? "pending" : "ready"}
    </button>
  )
}

describe("ProjectPinningProvider", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("shares optimistic and pending state across hook consumers", async () => {
    let resolveMutation: (() => void) | undefined
    mocks.togglePinned.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveMutation = resolve
      })
    )

    act(() => {
      root.render(
        <ProjectPinningProvider>
          <PinProbe label="sidebar" />
          <PinProbe label="page" />
        </ProjectPinningProvider>
      )
    })

    act(() => {
      container.querySelector("button")?.click()
    })

    expect(container.textContent).toContain("sidebar:pinned:pending")
    expect(container.textContent).toContain("page:pinned:pending")

    await act(async () => resolveMutation?.())

    expect(container.textContent).toContain("sidebar:pinned:ready")
    expect(container.textContent).toContain("page:pinned:ready")
  })
})
