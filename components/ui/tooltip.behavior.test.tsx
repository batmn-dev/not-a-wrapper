/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip"

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount() {
  await act(async () => root.render(
    <TooltipProvider>
      {["Send", "Attach"].map((label) => (
        <Tooltip key={label}>
          <TooltipTrigger>{label}</TooltipTrigger>
          <TooltipContent>{label} help</TooltipContent>
        </Tooltip>
      ))}
    </TooltipProvider>
  ))
  return Array.from(host.querySelectorAll("button"))
}

async function hover(trigger: HTMLElement) {
  await act(async () => {
    const pointer = new MouseEvent("pointerover", { bubbles: true })
    Object.defineProperty(pointer, "pointerType", { value: "mouse" })
    trigger.dispatchEvent(pointer)
    trigger.dispatchEvent(new MouseEvent("mouseenter"))
    trigger.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))
  })
}
const openTooltips = () => Array.from(document.querySelectorAll('[data-slot="tooltip-content"][data-open]')).map((node) => node.textContent)
async function advance(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms) })
}

describe("shared tooltip hover intent", () => {
  it("opens sustained hover after 150ms and keeps neighboring tooltip discovery immediate", async () => {
    const [send, attach] = await mount()
    await hover(send)
    await advance(100)
    expect(openTooltips()).toEqual([])
    await advance(100)
    expect(openTooltips()).toEqual(["Send help"])
    await act(async () => send.dispatchEvent(new MouseEvent("mouseleave")))
    await hover(attach)
    await advance(20)
    expect(openTooltips()).toEqual(["Attach help"])
    await act(async () => attach.dispatchEvent(new MouseEvent("mouseleave")))
    await advance(500)
    await hover(send)
    await advance(100)
    expect(openTooltips()).toEqual([])
    await advance(100)
    expect(openTooltips()).toEqual(["Send help"])
  })

  it("cancels a pending hover when the trigger is quickly clicked", async () => {
    const [send] = await mount()
    await hover(send)
    await advance(50)
    await act(async () => {
      const pointer = new MouseEvent("pointerdown", { bubbles: true })
      Object.defineProperty(pointer, "pointerType", { value: "mouse" })
      send.dispatchEvent(pointer)
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    await advance(200)
    expect(openTooltips()).toEqual([])
  })

  it("opens keyboard-focus help immediately without waiting for hover intent", async () => {
    const [send] = await mount()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
      send.focus()
    })
    expect(openTooltips()).toEqual(["Send help"])
  })
})
