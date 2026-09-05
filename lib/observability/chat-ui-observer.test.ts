/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installChatUiObserver, type ChatUiWindow } from "./chat-ui-observer"

let now = 0
let frames: FrameRequestCallback[] = []
const page = `<div contenteditable="true"></div><button data-testid="send-button" aria-label="Send prompt">Send</button>`

async function paint() {
  await Promise.resolve()
  now += 16
  const batch = frames
  frames = []
  batch.forEach((callback) => callback(now))
  vi.advanceTimersByTime(0)
}
function send() {
  const event = new MouseEvent("click", { bubbles: true })
  Object.defineProperty(event, "timeStamp", { value: now })
  document.querySelector("button")!.dispatchEvent(event)
  if (
    document.querySelector("button")!.getAttribute("aria-label") ===
    "Send prompt"
  )
    (window as ChatUiWindow).__chatUiPerf?.confirmSend()
}
function answer(length = 3) {
  const section = document.createElement("section")
  section.dataset.turnId = "current"
  section.innerHTML = `<div data-message-author-role="user">question</div><div data-message-author-role="assistant" data-perf-text-length="${length}"><div class="markdown">abc</div></div>`
  document.body.append(section)
  return section
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  now = 0
  frames = []
  document.body.innerHTML = page
  vi.spyOn(performance, "now").mockImplementation(() => now)
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    right: 100,
    top: 0,
    bottom: 100,
    width: 100,
    height: 100,
    toJSON: () => ({}),
  })
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      static supportedEntryTypes: string[] = []
    }
  )
})
afterEach(() => {
  ;(window as ChatUiWindow).__chatUiPerf?.dispose()
  vi.useRealTimers()
  document.body.innerHTML = ""
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("DOM/frame observations", () => {
  it("retains individual EventTiming entries even when they share an interaction", () => {
    let deliver: ((list: PerformanceObserverEntryList) => void) | undefined
    vi.stubGlobal("PerformanceObserver", class {
      static supportedEntryTypes = ["event"]
      constructor(callback: PerformanceObserverCallback) {
        deliver = (list) => callback(list, this)
      }
      observe() {}
      disconnect() {}
      takeRecords() { return [] }
    })
    const report = vi.fn()
    installChatUiObserver({ report })
    const entries = [16, 80].map((duration) => ({
      duration,
      interactionId: 7,
      entryType: "event",
      name: "pointerup",
      startTime: 0,
      toJSON: () => ({}),
    }))
    deliver!({
      getEntries: () => entries,
      getEntriesByName: () => entries,
      getEntriesByType: () => entries,
    })
    expect((window as ChatUiWindow).__chatUiPerf!.values.eventTimingEntryMs)
      .toEqual([16, 80])
    expect(report.mock.calls).toEqual([
      ["eventTimingEntryMs", 16],
      ["eventTimingEntryMs", 80],
    ])
  })

  it("checks DOM in the frame and records in its following task, cancelling stale tasks", async () => {
    installChatUiObserver()
    send()
    answer()
    await Promise.resolve()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    const geometry = vi.mocked(HTMLElement.prototype.getBoundingClientRect)
    expect(geometry).not.toHaveBeenCalled()
    expect(observer.values.inputToFirstTextFrameMs).toBeUndefined()
    now = 16
    const batch = frames
    frames = []
    batch.forEach((callback) => callback(now))
    expect(geometry).toHaveBeenCalled()
    geometry.mockClear()
    expect(observer.values.inputToFirstTextFrameMs).toBeUndefined()
    expect(frames).toHaveLength(0)
    now = 18
    vi.advanceTimersByTime(0)
    expect(geometry).not.toHaveBeenCalled()
    expect(observer.values.inputToFirstTextFrameMs).toEqual([18])

    for (const cleanup of [() => observer.reset(), () => observer.dispose()]) {
      send()
      answer()
      await Promise.resolve()
      const nextBatch = frames
      frames = []
      nextBatch.forEach((callback) => callback(now))
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      cleanup()
      expect(vi.getTimerCount()).toBe(0)
    }
  })

  it("waits for semantic Send readiness and observes aria-disabled changes", async () => {
    const button = document.querySelector("button")!
    button.setAttribute("aria-disabled", "true")
    installChatUiObserver()
    document
      .querySelector("[contenteditable]")!
      .dispatchEvent(new InputEvent("input", { bubbles: true }))
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.navigationToComposerInputMs
    ).toHaveLength(1)
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.navigationToSendReadyMs
    ).toBeUndefined()
    button.setAttribute("aria-disabled", "false")
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.navigationToSendReadyMs
    ).toHaveLength(1)
  })

  it("observes popup positioning without waiting for unrelated stream mutations", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<button data-testid="composer-plus-btn">Add</button><div data-chat-composer-menu style="opacity:0">Menu</div>'
    )
    const popup = document.querySelector<HTMLElement>(
      "[data-chat-composer-menu]"
    )!
    Object.assign(popup, { checkVisibility: () => popup.style.opacity !== "0" })
    installChatUiObserver()
    document
      .querySelector<HTMLElement>('[data-testid="composer-plus-btn"]')!
      .click()
    popup.textContent = "Positioning"
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.menuToFrameMs
    ).toBeUndefined()
    popup.style.opacity = "1"
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.menuToFrameMs
    ).toHaveLength(1)
  })

  it("menu-consumed Enter does not reset the active stream", async () => {
    installChatUiObserver()
    send()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    const receive = observer.bindStream()
    receive("text-delta", 3)
    const editor = document.querySelector("[contenteditable]")!
    editor.addEventListener("keydown", (event) => event.preventDefault())
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      })
    )
    await Promise.resolve()
    now = 250
    receive("text-delta", 3)
    expect(observer.pendingDeltas()).toBe(2)
  })

  it("retains the oldest input waiting for the same frame", async () => {
    installChatUiObserver()
    const editor = document.querySelector("[contenteditable]")!
    for (const at of [0, 40]) {
      now = at
      const key = new KeyboardEvent("keydown", { key: "a", bubbles: true })
      Object.defineProperty(key, "timeStamp", { value: at })
      editor.dispatchEvent(key)
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }))
    }
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.typingToFrameMs
    ).toEqual([56])
  })
  it("observes the editor-owned popup without requiring menu semantics", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<button data-testid="composer-plus-btn">Add</button>'
    )
    installChatUiObserver()
    document
      .querySelector<HTMLElement>('[data-testid="composer-plus-btn"]')!
      .click()
    document.body.insertAdjacentHTML(
      "beforeend",
      "<div data-chat-composer-menu>Upload files</div>"
    )
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.menuToFrameMs
    ).toHaveLength(1)
  })
  it("a detached transport cannot contaminate a later send", () => {
    installChatUiObserver()
    send()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    const detached = observer.bindStream()
    send()
    detached("text-delta", 100)
    expect(observer.pendingDeltas()).toBe(0)
    observer.bindStream()("text-delta", 10)
    expect(observer.pendingDeltas()).toBe(1)
  })
  it("does not mistake the preceding answer for the new response, and waits for a frame opportunity", async () => {
    answer()
    installChatUiObserver()
    send()
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.inputToFirstTextFrameMs
    ).toBeUndefined()
    answer()
    await Promise.resolve()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.inputToFirstTextFrameMs
    ).toBeUndefined()
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.inputToFirstTextFrameMs
    ).toEqual([32])
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.inputToOptimisticFrameMs
    ).toEqual([32])
  })

  it("only acknowledges received content once its rendered source watermark catches up", async () => {
    installChatUiObserver()
    send()
    const section = answer(3)
    ;(window as ChatUiWindow).__chatUiPerf!.receive("text-delta", 10)
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.deltaToContentFrameMs
    ).toBeUndefined()
    section.querySelector<HTMLElement>(
      "[data-perf-text-length]"
    )!.dataset.perfTextLength = "10"
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.deltaToContentFrameMs
    ).toEqual([32])
    expect((window as ChatUiWindow).__chatUiPerf!.pendingDeltas()).toBe(0)
  })

  it("measures Stop feedback even when the empty composer Send button is disabled", async () => {
    installChatUiObserver()
    send()
    answer()
    const button = document.querySelector("button")!
    button.setAttribute("aria-label", "Stop")
    now = 100
    send()
    button.setAttribute("aria-label", "Send prompt")
    button.disabled = true
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.stopToReadyFrameMs
    ).toEqual([16])
  })

  it("invalidates measurements when the tab becomes hidden", async () => {
    installChatUiObserver()
    send()
    answer()
    await Promise.resolve()
    const batch = frames
    frames = []
    batch.forEach((callback) => callback(now))
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    document.dispatchEvent(new Event("visibilitychange"))
    await paint()
    expect((window as ChatUiWindow).__chatUiPerf!.hidden).toBe(true)
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.inputToFirstTextFrameMs
    ).toBeUndefined()
  })

  it("production sampling can resume new turns without reporting another page load", async () => {
    installChatUiObserver({ resumeOnVisible: true })
    send()
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    document.dispatchEvent(new Event("visibilitychange"))
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    document.dispatchEvent(new Event("visibilitychange"))
    send()
    answer()
    await paint()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    expect(observer.hidden).toBe(false)
    expect(observer.values.inputToFirstTextFrameMs).toHaveLength(1)
    expect(observer.values.navigationToSendReadyMs).toBeUndefined()
  })
})
