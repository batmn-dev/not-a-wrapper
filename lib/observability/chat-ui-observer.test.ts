/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { alignThreadScrollTarget } from "@/app/components/chat/thread-scroll-target"
import { noteChatProgrammaticScroll } from "./chat-ui-events"
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

function scrollRoot() {
  document.body.insertAdjacentHTML("beforeend", "<div data-scroll-root></div>")
  const root = document.querySelector<HTMLElement>("[data-scroll-root]")!
  Object.defineProperties(root, {
    clientHeight: { value: 500 },
    scrollHeight: { value: 1500 },
  })
  return root
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
  delete (window as ChatUiWindow).__chatUiPerfDisabled
  vi.useRealTimers()
  document.body.innerHTML = ""
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("DOM/frame observations", () => {
  it("uses prepared geometry when native scrolling precedes passive wheel delivery", async () => {
    const root = scrollRoot()
    installChatUiObserver({ requireWheelPreparation: true })
    const observer = (window as ChatUiWindow).__chatUiPerf!
    observer.setPhase("late")
    now = 50
    observer.prepareWheel(root, 400)
    root.scrollTop = 400
    root.dispatchEvent(new Event("scroll"))
    now = 120
    const event = new WheelEvent("wheel", { bubbles: true, deltaY: 400 })
    Object.defineProperty(event, "timeStamp", { value: 100 })
    root.dispatchEvent(event)
    await paint()
    expect(observer.values.scrollToFrameLateMs).toEqual([36])
    expect(observer.wheelDiagnostics()).toMatchObject({
      reason: "recorded", preparedTop: 0, deliveryTop: 400, eventAt: 100,
      deliveryAt: 120, received: 1, armed: 1, pending: false, prepared: false,
    })
    expect(observer.droppedSamples()).toBe(0)
    root.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }))
    expect(observer.wheelDiagnostics().reason).toBe("missing-preparation")
    expect(observer.droppedSamples()).toBe(1)
  })
  it.each(["missing", "stale", "direction", "programmatic", "input", "route", "watchdog"])("rejects %s wheel preparation instead of using post-input geometry", async (failure) => {
    const root = scrollRoot()
    installChatUiObserver({ requireWheelPreparation: true })
    const observer = (window as ChatUiWindow).__chatUiPerf!
    const path = location.pathname
    now = 50
    if (failure !== "missing") observer.prepareWheel(root, 400)
    if (failure === "programmatic") noteChatProgrammaticScroll(root)
    if (failure === "input") document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
    if (failure === "watchdog") vi.advanceTimersByTime(5000)
    try {
      if (failure === "route") history.pushState(null, "", "/c/prepared-wheel-other")
      root.scrollTop = 400
      now = 120
      const event = new WheelEvent("wheel", { bubbles: true, deltaY: failure === "direction" ? -400 : 400 })
      Object.defineProperty(event, "timeStamp", { value: failure === "stale" ? 20 : 100 })
      root.dispatchEvent(event)
      await paint()
      expect(observer.values.scrollToFrameMs).toBeUndefined()
      expect(observer.droppedSamples()).toBeGreaterThan(0)
      expect(observer.wheelDiagnostics().prepared).toBe(false)
    } finally {
      history.replaceState(null, "", path)
    }
  })
  it.each(["hidden", "dispose", "reset"])("clears a prepared wheel watchdog on %s", (action) => {
    const root = scrollRoot()
    installChatUiObserver({ requireWheelPreparation: true })
    const observer = (window as ChatUiWindow).__chatUiPerf!
    observer.prepareWheel(root, 400)
    if (action === "hidden") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    } else if (action === "dispose") observer.dispose()
    else observer.reset()
    vi.advanceTimersByTime(5000)
    expect(observer.droppedSamples()).toBe(0)
    expect(observer.wheelDiagnostics().prepared).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
  it("honors the benchmark opt-out when a delayed import tries to reinstall", () => {
    installChatUiObserver()
    const pageWindow = window as ChatUiWindow
    pageWindow.__chatUiPerfDisabled = true
    pageWindow.__chatUiPerf!.dispose()
    installChatUiObserver()
    expect(pageWindow.__chatUiPerf).toBeUndefined()
    delete pageWindow.__chatUiPerfDisabled
    installChatUiObserver()
    expect(pageWindow.__chatUiPerf).toBeDefined()
  })
  it("retains individual EventTiming entries even when they share an interaction", () => {
    let deliver: ((list: PerformanceObserverEntryList) => void) | undefined
    vi.stubGlobal(
      "PerformanceObserver",
      class {
        static supportedEntryTypes = ["event"]
        constructor(callback: PerformanceObserverCallback) {
          deliver = (list) => callback(list, this)
        }
        observe() {}
        disconnect() {}
        takeRecords() {
          return []
        }
      }
    )
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
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.eventTimingEntryMs
    ).toEqual([16, 80])
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

  it("waits for a delayed scroll event and preserves the oldest pending wheel", async () => {
    const root = scrollRoot()
    installChatUiObserver()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    observer.setPhase("late")
    const wheel = (at: number) => {
      now = at
      const event = new WheelEvent("wheel", { bubbles: true, deltaY: 400 })
      Object.defineProperty(event, "timeStamp", { value: at })
      root.dispatchEvent(event)
    }
    wheel(100)
    await paint()
    expect(observer.values.scrollToFrameMs).toBeUndefined()
    observer.setPhase("early")
    wheel(120)
    root.scrollTop = 400
    root.dispatchEvent(new Event("scroll"))
    expect(observer.values.scrollToFrameMs).toBeUndefined()
    await paint()
    expect(observer.values.scrollToFrameMs).toEqual([36])
    expect(observer.values.scrollToFrameLateMs).toEqual([36])
    expect(observer.values.scrollToFrameEarlyMs).toBeUndefined()
    root.scrollTop = 450
    root.dispatchEvent(new Event("scroll"))
    await paint()
    expect(observer.values.scrollToFrameMs).toEqual([36])
  })

  it("does not credit a scroll mutation after the inspected frame", async () => {
    const root = scrollRoot()
    installChatUiObserver()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    const event = new WheelEvent("wheel", { bubbles: true, deltaY: 400 })
    Object.defineProperty(event, "timeStamp", { value: 0 })
    root.dispatchEvent(event)
    await Promise.resolve()
    now = 16
    const batch = frames
    frames = []
    batch.forEach((callback) => callback(now))
    root.scrollTop = 400
    root.dispatchEvent(new Event("scroll"))
    now = 18
    vi.advanceTimersByTime(0)
    expect(observer.values.scrollToFrameMs).toBeUndefined()
    await paint()
    expect(observer.values.scrollToFrameMs).toEqual([34])
  })
  it("invalidates an unmatched wheel at the watchdog without crediting a later scroll", async () => {
    const root = scrollRoot()
    installChatUiObserver()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    root.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }))
    await paint()
    expect(observer.droppedSamples()).toBe(0)
    await paint()
    await paint()
    expect(observer.droppedSamples()).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(observer.droppedSamples()).toBe(1)
    expect(frames).toHaveLength(0)
    root.scrollTop = 400
    root.dispatchEvent(new Event("scroll"))
    await paint()
    expect(observer.values.scrollToFrameMs).toBeUndefined()
    expect(observer.droppedSamples()).toBe(1)
  })
  it("rejects movement opposite to the pending wheel direction", async () => {
    const root = scrollRoot()
    root.scrollTop = 500
    installChatUiObserver()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    root.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }))
    root.scrollTop = 400
    root.dispatchEvent(new Event("scroll"))
    await paint()
    await paint()
    expect(observer.values.scrollToFrameMs).toBeUndefined()
    expect(observer.droppedSamples()).toBe(1)
  })
  it("keeps the full latency of native scrolling delayed beyond two frames", async () => {
    const root = scrollRoot()
    installChatUiObserver()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    const event = new WheelEvent("wheel", { bubbles: true, deltaY: 100 })
    Object.defineProperty(event, "timeStamp", { value: 0 })
    root.dispatchEvent(event)
    await paint()
    await paint()
    await paint()
    expect(observer.droppedSamples()).toBe(0)
    now = 250
    root.scrollTop = 100
    root.dispatchEvent(new Event("scroll"))
    await paint()
    expect(observer.values.scrollToFrameMs).toEqual([266])
    expect(observer.droppedSamples()).toBe(0)
  })
  it("invalidates a pending wheel before a programmatic root scroll", async () => {
    const root = scrollRoot()
    installChatUiObserver()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    root.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }))
    noteChatProgrammaticScroll(document.createElement("div"))
    expect(observer.droppedSamples()).toBe(0)
    const target = document.createElement("section")
    target.dataset.turnIdContainer = "target"
    root.append(target)
    vi.stubGlobal("CSS", { escape: (value: string) => value })
    target.scrollIntoView = () => {
      expect(observer.droppedSamples()).toBe(1)
      root.scrollTop = 100
    }
    alignThreadScrollTarget(root, { turnId: "target" }, () => "instant")
    root.dispatchEvent(new Event("scroll"))
    await paint()
    vi.advanceTimersByTime(5000)
    expect(observer.values.scrollToFrameMs).toBeUndefined()
    expect(observer.droppedSamples()).toBe(1)
  })
  it.each(["pointerdown", "keydown", "beforeinput", "touchstart"])("invalidates a pending wheel on competing %s input", async (type) => {
    const root = scrollRoot()
    installChatUiObserver()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    root.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }))
    document.dispatchEvent(type === "keydown" ? new KeyboardEvent(type, { key: "ArrowDown" }) : new Event(type))
    root.scrollTop = 100
    root.dispatchEvent(new Event("scroll"))
    await paint()
    expect(observer.values.scrollToFrameMs).toBeUndefined()
    expect(observer.droppedSamples()).toBe(1)
  })
  it.each(["root", "route"])("invalidates a pending wheel when its %s changes", async (change) => {
    const previousPath = location.pathname
    const root = scrollRoot()
    installChatUiObserver()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    root.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }))
    try {
      if (change === "root") root.remove()
      else history.pushState(null, "", "/c/wheel-destination")
      root.scrollTop = 100
      await paint()
      expect(observer.values.scrollToFrameMs).toBeUndefined()
      expect(observer.droppedSamples()).toBe(1)
      vi.advanceTimersByTime(5000)
      expect(observer.droppedSamples()).toBe(1)
    } finally {
      history.replaceState(null, "", previousPath)
    }
  })
  it.each(["hidden", "dispose", "reset", "send"])("clears the wheel watchdog on %s", (action) => {
    const root = scrollRoot()
    installChatUiObserver()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    root.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }))
    if (action === "hidden") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    } else if (action === "send") send()
    else if (action === "dispose") observer.dispose()
    else observer.reset()
    const dropped = observer.droppedSamples()
    vi.advanceTimersByTime(5000)
    expect(observer.droppedSamples()).toBe(dropped)
    expect(vi.getTimerCount()).toBe(0)
  })
  it("does not attribute chat scrolling to a wheel event outside the transcript", async () => {
    const root = scrollRoot()
    installChatUiObserver()
    document.body.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: 400 })
    )
    root.scrollTop = 400
    root.dispatchEvent(new Event("scroll"))
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.scrollToFrameMs
    ).toBeUndefined()
  })
  it.each([
    { top: 0, init: { deltaY: -100 } },
    { top: 1000, init: { deltaY: 100 } },
    { top: 0, init: { deltaY: 100, ctrlKey: true } },
    { top: 0, init: { deltaY: 100, shiftKey: true } },
    { top: 0, init: { deltaX: 100 } },
  ])(
    "does not arm a wheel that cannot directly scroll the transcript: %j",
    async ({ top, init }) => {
      const root = scrollRoot()
      root.scrollTop = top
      installChatUiObserver()
      root.dispatchEvent(new WheelEvent("wheel", { bubbles: true, ...init }))
      root.scrollTop = 400
      root.dispatchEvent(new Event("scroll"))
      await paint()
      expect(
        (window as ChatUiWindow).__chatUiPerf!.values.scrollToFrameMs
      ).toBeUndefined()
    }
  )
  it("does not attribute a nested scroller's wheel to the transcript", async () => {
    const root = scrollRoot()
    const nested = document.createElement("div")
    nested.style.overflowY = "auto"
    Object.defineProperties(nested, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 200 },
    })
    root.append(nested)
    installChatUiObserver()
    nested.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: 100 })
    )
    root.scrollTop = 400
    root.dispatchEvent(new Event("scroll"))
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.scrollToFrameMs
    ).toBeUndefined()
  })
  it("invalidates a wheel cancelled after the capture listener", async () => {
    const root = scrollRoot()
    installChatUiObserver()
    root.addEventListener("wheel", (event) => event.preventDefault(), {
      once: true,
    })
    root.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 })
    )
    root.scrollTop = 400
    root.dispatchEvent(new Event("scroll"))
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.scrollToFrameMs
    ).toBeUndefined()
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

  it("does not credit another conversation's content to a detached send", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<a data-sidebar-item="true" href="/c/other">Other chat</a>'
    )
    installChatUiObserver()
    send()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    const receive = observer.bindStream()
    const current = document.createElement("section")
    current.dataset.turnId = "current"
    current.innerHTML =
      '<div data-message-author-role="user">New question</div>'
    document.body.append(current)
    await paint()
    const optimisticSamples = [...observer.values.inputToOptimisticFrameMs!]
    const link = document.querySelector("a")!
    link.addEventListener("click", (event) => event.preventDefault())
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    )
    // Clicking without a committed destination (including Ctrl-click) preserves A.
    receive("text-delta", 10)
    await paint()
    expect(observer.pendingDeltas()).toBe(1)
    expect(observer.values.inputToFirstTextFrameMs).toBeUndefined()

    history.pushState(null, "", "/c/other")
    current.remove()
    answer(100)
    await paint()
    receive("text-delta", 10)
    receive("finish")
    await paint()
    expect(observer.values.inputToFirstTextFrameMs).toBeUndefined()
    expect(observer.values.deltaToContentFrameMs).toBeUndefined()
    expect(observer.values.terminalToReadyFrameMs).toBeUndefined()
    expect(observer.pendingDeltas()).toBe(0)
    expect(observer.values.inputToOptimisticFrameMs).toEqual(optimisticSamples)
    expect(observer.values.threadSwitchToFrameMs).toHaveLength(1)
    history.replaceState(null, "", "/")
  })
  it("keeps follow-up measurements after clicking the current sidebar row", async () => {
    history.replaceState(null, "", "/c/current")
    answer()
    document.body.insertAdjacentHTML(
      "beforeend",
      '<a data-sidebar-item="true" href="/c/current">Current</a>'
    )
    installChatUiObserver()
    const link = document.querySelector("a")!
    link.addEventListener("click", (event) => event.preventDefault())
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    )
    send()
    answer()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    observer.bindStream()("text-delta", 3)
    await paint()
    expect(observer.values.inputToFirstTextFrameMs).toHaveLength(1)
    expect(observer.values.deltaToContentFrameMs).toHaveLength(1)
    expect(observer.values.threadSwitchToFrameMs).toBeUndefined()
    history.replaceState(null, "", "/")
  })
  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])("ignores modified/nonprimary sidebar clicks: %j", async (init) => {
    answer()
    document.body.insertAdjacentHTML(
      "beforeend",
      '<a data-sidebar-item="true" href="/c/other">Other</a>'
    )
    installChatUiObserver()
    const link = document.querySelector("a")!
    link.addEventListener("click", (event) => event.preventDefault())
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, ...init })
    )
    history.pushState(null, "", "/c/other")
    answer()
    await paint()
    expect(
      (window as ChatUiWindow).__chatUiPerf!.values.threadSwitchToFrameMs
    ).toBeUndefined()
    history.replaceState(null, "", "/")
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

  it("observes the first visible reveal frame without waiting for another slab or animation end", async () => {
    installChatUiObserver()
    send()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    const markdown = answer(4096).querySelector<HTMLElement>(".markdown")!
    let visible = false
    const animation = {
      pending: false, playState: "running", currentTime: 0,
      effect: { getComputedTiming: () => ({ endTime: 180 }) },
    }
    Object.assign(markdown, {
      checkVisibility: () => visible,
      getAnimations: () => [animation],
    })
    now = 100
    observer.receive("text-delta", 4096)
    await paint()
    expect(observer.values.deltaToContentFrameMs).toBeUndefined()
    expect(frames).toHaveLength(1)
    // CSS opacity advances without a DOM mutation or another received slab.
    visible = true
    await paint()
    expect(observer.values.deltaToContentFrameMs).toEqual([32])
    expect(observer.values.inputToFirstTextFrameMs).toEqual([132])
    expect(observer.pendingDeltas()).toBe(0)
    expect(frames).toHaveLength(0)
  })
  it.each(["offscreen", "infinite", "finished", "uncommitted"])("does not poll %s content for an opacity reveal", async (condition) => {
    installChatUiObserver()
    send()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    const markdown = answer(condition === "uncommitted" ? 3 : 4096)
      .querySelector<HTMLElement>(".markdown")!
    Object.assign(markdown, {
      checkVisibility: () => false,
      getAnimations: () => [{
        pending: false, playState: condition === "finished" ? "finished" : "running", currentTime: 0,
        effect: { getComputedTiming: () => ({ endTime: condition === "infinite" ? Infinity : 180 }) },
      }],
    })
    if (condition === "offscreen")
      markdown.getBoundingClientRect = () => ({ width: 100, height: 100, top: 10000, bottom: 10100 }) as DOMRect
    observer.receive("text-delta", 4096)
    await paint()
    expect(frames).toHaveLength(0)
    expect(observer.pendingDeltas()).toBe(1)
  })
  it("bounds rescanning if a pending animation never advances", async () => {
    installChatUiObserver()
    send()
    const observer = (window as ChatUiWindow).__chatUiPerf!
    const markdown = answer(4096).querySelector<HTMLElement>(".markdown")!
    const animation = { pending: true, currentTime: null, effect: { getComputedTiming: () => ({ endTime: 180 }) } }
    Object.assign(markdown, { checkVisibility: () => false, getAnimations: () => [animation] })
    observer.receive("text-delta", 4096)
    await paint()
    expect(frames).toHaveLength(1)
    now = 200
    await paint()
    expect(frames).toHaveLength(0)
    expect(observer.pendingDeltas()).toBe(1)
    expect(observer.values.deltaToContentFrameMs).toBeUndefined()
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
