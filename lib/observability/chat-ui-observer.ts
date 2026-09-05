/** Content-free DOM/frame proxies. No text, message identity, or URLs leave this observer. */
export type ChatUiMetric =
  | "navigationToComposerInputMs"
  | "navigationToSendReadyMs"
  | "inputToOptimisticFrameMs"
  | "inputToFirstTextFrameMs"
  | "inputToFirstActivityFrameMs"
  | "typingToFrameMs"
  | "typingToFrameEarlyMs"
  | "typingToFrameLateMs"
  | "menuToFrameMs"
  | "menuToFrameEarlyMs"
  | "menuToFrameLateMs"
  | "scrollToFrameMs"
  | "scrollToFrameEarlyMs"
  | "scrollToFrameLateMs"
  | "deltaToContentFrameMs"
  | "deltaToContentFrameEarlyMs"
  | "deltaToContentFrameLateMs"
  | "terminalToReadyFrameMs"
  | "stopToReadyFrameMs"
  | "lcpMs"
  | "eventTimingEntryMs"
  | "threadSwitchToFrameMs"
  | "navigationToThreadFrameMs"

export type ChatUiObserver = {
  values: Partial<Record<ChatUiMetric, number[]>>
  hidden: boolean
  pendingDeltas: () => number
  droppedSamples: () => number
  confirmSend: () => void
  setPhase: (phase: "early" | "late") => void
  receive: (type: string, length?: number) => void
  bindStream: () => (type: string, length?: number) => void
  reset: () => void
  dispose: () => void
}

export type ChatUiWindow = Window & {
  __chatUiPerf?: ChatUiObserver
  /** Benchmark opt-out survives a delayed instrumentation import after disposal. */
  __chatUiPerfDisabled?: boolean
}

/** Self-contained so the benchmark can install the identical observer before navigation. */
export function installChatUiObserver(
  options: {
    report?: (metric: ChatUiMetric, durationMs: number) => void
    resumeOnVisible?: boolean
  } = {}
): void {
  const observedWindow = window as ChatUiWindow
  if (observedWindow.__chatUiPerfDisabled || observedWindow.__chatUiPerf) return
  const values: ChatUiObserver["values"] = {}
  const observers: PerformanceObserver[] = []
  const frames = new Set<number>()
  const frameTasks = new Set<ReturnType<typeof setTimeout>>()
  let hidden = document.visibilityState !== "visible"
  let sentAt: number | undefined
  let sendCandidate: number | undefined
  let candidateTimer: ReturnType<typeof setTimeout> | undefined
  let lcpReported = false
  let stopAt: number | undefined
  let terminalAt: number | undefined
  let previousUser: Element | undefined
  let textLength = 0
  let sampledAt = -Infinity
  let phase: "early" | "late" | undefined
  let samples: Array<{ at: number; length: number; phase: typeof phase }> = []
  let dropped = 0
  let turn = 0
  let queued = false
  let inputAt: number | undefined
  let inputPending = false
  let menuAt: number | undefined
  let pendingWheel:
    | {
        at: number
        start: number
        phase: typeof phase
        root: HTMLElement
        event: WheelEvent
        remainingFrames: number
      }
    | undefined
  let navigation:
    { at: number; previous: Element | undefined; pathname: string } | undefined
  const once = new Set<string>()
  const editorSelector = '[contenteditable="true"]'
  const sendSelector = '[data-testid="send-button"]'
  const userSelector = '[data-message-author-role="user"]'
  const lastTurn = () =>
    Array.from(document.querySelectorAll("section[data-turn-id]")).at(-1)
  const isVisible = (
    element: Element | null | undefined
  ): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false
    if (
      element.checkVisibility &&
      !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    )
      return false
    const rect = element.getBoundingClientRect()
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < innerHeight
    )
  }
  const record = (
    metric: ChatUiMetric,
    startedAt: number,
    at = performance.now()
  ) => {
    if (hidden || document.visibilityState !== "visible") return
    const duration = Math.max(0, at - startedAt)
    const entries = values[metric] ?? (values[metric] = [])
    if (entries.length < 4096) entries.push(duration)
    else dropped++
    options.report?.(metric, duration)
  }
  const frame = (callback: () => void) => {
    const id = requestAnimationFrame(() => {
      frames.delete(id)
      callback()
    })
    frames.add(id)
  }
  const postFrameTask = (callback: () => void) => {
    const timer = setTimeout(() => {
      frameTasks.delete(timer)
      callback()
    }, 0)
    frameTasks.add(timer)
  }
  // scan() inspects DOM in rAF; a later task follows that rendering opportunity
  // without waiting for another frame. This is not a pixel-presentation timestamp.
  const recordFrame = (metric: ChatUiMetric, at: number) => {
    const observedTurn = turn
    postFrameTask(() => {
      if (turn === observedTurn || metric.startsWith("navigation"))
        record(metric, at)
    })
  }
  const recordOnce = (metric: ChatUiMetric, at: number) => {
    if (once.has(metric)) return
    once.add(metric)
    recordFrame(metric, at)
  }
  const phaseMetric = (
    metric: "typingToFrame" | "menuToFrame" | "scrollToFrame",
    observedPhase: typeof phase
  ): ChatUiMetric =>
    `${metric}${observedPhase === "early" ? "Early" : "Late"}Ms`
  const recordInteractionFrame = (
    metric: "typingToFrame" | "menuToFrame",
    at: number
  ) => {
    recordFrame(`${metric}Ms`, at)
    if (phase) recordFrame(phaseMetric(metric, phase), at)
  }
  const scan = () => {
    if (pendingWheel) {
      const wheel = pendingWheel
      if (
        wheel.event.defaultPrevented ||
        document.querySelector("[data-scroll-root]") !== wheel.root
      ) {
        pendingWheel = undefined
      } else if (
        (wheel.root.scrollTop - wheel.start) * Math.sign(wheel.event.deltaY) > 0
      ) {
        pendingWheel = undefined
        recordFrame("scrollToFrameMs", wheel.at)
        if (wheel.phase)
          recordFrame(phaseMetric("scrollToFrame", wheel.phase), wheel.at)
      } else if (--wheel.remainingFrames === 0) {
        // An unmatched wheel invalidates the capture; it cannot claim later scrolling.
        pendingWheel = undefined
        dropped++
      } else {
        schedule()
      }
    }
    const editor = document.querySelector(editorSelector)
    const send = document.querySelector<HTMLButtonElement>(sendSelector)
    const row = lastTurn()
    if (
      (!once.has("navigationToThreadFrameMs") || navigation) &&
      isVisible(row) &&
      row.textContent?.trim()
    ) {
      recordOnce("navigationToThreadFrameMs", 0)
      if (
        navigation &&
        row !== navigation.previous &&
        location.pathname === navigation.pathname
      ) {
        // A committed sidebar switch ends the old turn's visible-content probe.
        // Merely clicking a link (for example, Ctrl-click) does not abandon it.
        turn++
        sentAt = sendCandidate = stopAt = terminalAt = undefined
        clearTimeout(candidateTimer)
        samples = []
        pendingWheel = undefined
        phase = undefined
        recordFrame("threadSwitchToFrameMs", navigation.at)
        navigation = undefined
      }
    }
    if (inputPending && isVisible(editor)) {
      inputPending = false
      recordOnce("navigationToComposerInputMs", 0)
      if (inputAt !== undefined)
        recordInteractionFrame("typingToFrame", inputAt)
      inputAt = undefined
    }
    if (
      (!once.has("navigationToSendReadyMs") ||
        (terminalAt !== undefined && !once.has("terminalToReadyFrameMs")) ||
        (stopAt !== undefined && !once.has("stopToReadyFrameMs"))) &&
      send?.getAttribute("aria-label") === "Send prompt" &&
      isVisible(send)
    ) {
      if (!send.disabled && send.getAttribute("aria-disabled") !== "true")
        recordOnce("navigationToSendReadyMs", 0)
      if (terminalAt !== undefined)
        recordOnce("terminalToReadyFrameMs", terminalAt)
      if (stopAt !== undefined) {
        recordOnce("stopToReadyFrameMs", stopAt)
      }
    }
    if (
      menuAt !== undefined &&
      isVisible(document.querySelector("[data-chat-composer-menu]"))
    ) {
      recordInteractionFrame("menuToFrame", menuAt)
      menuAt = undefined
    }
    if (sentAt === undefined) return
    const users = document.querySelectorAll(userSelector)
    if (users.length === 0 || users[users.length - 1] === previousUser) return
    if (
      !once.has("inputToOptimisticFrameMs") &&
      isVisible(users[users.length - 1])
    )
      recordOnce("inputToOptimisticFrameMs", sentAt)
    const markdown = row?.querySelector(
      '[data-message-author-role="assistant"] .markdown'
    )
    if (
      !once.has("inputToFirstTextFrameMs") &&
      isVisible(markdown) &&
      markdown.textContent?.trim()
    )
      recordOnce("inputToFirstTextFrameMs", sentAt)
    // A disclosure means actual inspectable activity exists; bare "Thinking" is feedback only.
    const activity = row?.querySelector(
      'button[aria-label^="Open activity:"], button[aria-label^="Close activity:"]'
    )
    if (!once.has("inputToFirstActivityFrameMs") && isVisible(activity))
      recordOnce("inputToFirstActivityFrameMs", sentAt)
    const source = row?.querySelector<HTMLElement>("[data-perf-text-length]")
    const renderedLength = Number(source?.dataset.perfTextLength ?? 0)
    if (samples.length > 0 && isVisible(markdown)) {
      const ready = samples.filter((sample) => sample.length <= renderedLength)
      samples = samples.filter((sample) => sample.length > renderedLength)
      for (const sample of ready) {
        recordFrame("deltaToContentFrameMs", sample.at)
        if (sample.phase)
          recordFrame(
            sample.phase === "early"
              ? "deltaToContentFrameEarlyMs"
              : "deltaToContentFrameLateMs",
            sample.at
          )
      }
    }
  }
  const schedule = () => {
    if (queued) return
    queued = true
    frame(() => {
      queued = false
      scan()
    })
  }
  const reset = () => {
    turn++
    sentAt = sendCandidate = stopAt = terminalAt = inputAt = menuAt = undefined
    clearTimeout(candidateTimer)
    phase = undefined
    dropped = 0
    inputPending = false
    navigation = undefined
    pendingWheel = undefined
    frames.forEach(cancelAnimationFrame)
    frames.clear()
    frameTasks.forEach(clearTimeout)
    frameTasks.clear()
    queued = false
    samples = []
    textLength = 0
    sampledAt = -Infinity
    previousUser = Array.from(document.querySelectorAll(userSelector)).at(-1)
    for (const key of Object.keys(values) as ChatUiMetric[]) delete values[key]
    once.clear()
    hidden = document.visibilityState !== "visible"
    observedWindow.__chatUiPerf!.hidden = hidden
  }
  const beginSend = (at: number) => {
    turn++
    pendingWheel = undefined
    navigation = undefined
    // Keep the document's load and typing observations when beginning its first turn.
    sentAt = at
    phase = undefined
    stopAt = terminalAt = undefined
    textLength = 0
    samples = []
    sampledAt = -Infinity
    previousUser = Array.from(document.querySelectorAll(userSelector)).at(-1)
    for (const key of [...once])
      if (!key.startsWith("navigation")) once.delete(key)
    schedule()
  }
  const eventTime = (event: Event) =>
    event.timeStamp > performance.timeOrigin
      ? event.timeStamp - performance.timeOrigin
      : event.timeStamp
  // A key/click is only a candidate: editor menus can consume Enter instead of submitting.
  const candidateSend = (event: Event) => {
    const at = eventTime(event)
    sendCandidate = at
    clearTimeout(candidateTimer)
    // Keep the candidate through native form submission; microtasks can run between event listeners.
    candidateTimer = setTimeout(() => {
      if (sendCandidate === at) sendCandidate = undefined
    }, 0)
  }
  const pointer = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    const button = target?.closest<HTMLButtonElement>(sendSelector)
    if (button && !button.disabled) {
      if (button.getAttribute("aria-label") === "Stop")
        stopAt = eventTime(event)
      else candidateSend(event)
    }
    if (target?.closest('[data-testid="composer-plus-btn"]'))
      menuAt = eventTime(event)
    const link = target?.closest<HTMLAnchorElement>(
      'a[data-sidebar-item="true"][href^="/c/"]'
    )
    if (
      link &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      new URL(link.href).pathname !== location.pathname
    )
      navigation = {
        at: eventTime(event),
        previous: lastTurn(),
        pathname: new URL(link.href).pathname,
      }
  }
  const keydown = (event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target?.closest(editorSelector)) return
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing)
      candidateSend(event)
    else if (
      !event.metaKey &&
      !event.ctrlKey &&
      (event.key.length === 1 || event.key === "Backspace")
    )
      inputAt ??= eventTime(event)
  }
  const beforeinput = (event: Event) => {
    if (event.target instanceof Element && event.target.closest(editorSelector))
      inputAt ??= eventTime(event)
  }
  const input = (event: Event) => {
    if (
      event.target instanceof Element &&
      event.target.closest(editorSelector)
    ) {
      inputPending = true
      schedule()
    }
  }
  const wheel = (event: WheelEvent) => {
    const root = document.querySelector<HTMLElement>("[data-scroll-root]")
    if (
      !root ||
      !(event.target instanceof Node) ||
      !root.contains(event.target) ||
      event.ctrlKey ||
      event.shiftKey ||
      event.deltaY === 0 ||
      event.defaultPrevented
    )
      return
    const maxScroll = root.scrollHeight - root.clientHeight
    if (
      maxScroll <= 0 ||
      (event.deltaY < 0 ? root.scrollTop <= 0 : root.scrollTop >= maxScroll)
    )
      return
    // This proxy covers direct transcript scrolling, not nested scroll chaining.
    for (
      let node =
        event.target instanceof Element
          ? event.target
          : event.target.parentElement;
      node && node !== root;
      node = node.parentElement
    ) {
      if (
        node.scrollHeight > node.clientHeight &&
        /^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY)
      )
        return
    }
    if (pendingWheel?.event.defaultPrevented) pendingWheel = undefined
    pendingWheel ??= {
      at: eventTime(event),
      start: root.scrollTop,
      phase,
      root,
      event,
      remainingFrames: 2,
    }
    schedule()
  }
  const scroll = (event: Event) => {
    if (event.target === pendingWheel?.root) schedule()
  }
  const visibility = () => {
    if (document.visibilityState !== "visible") {
      if (!lcpReported && values.lcpMs?.[0] !== undefined) {
        options.report?.("lcpMs", values.lcpMs[0])
        lcpReported = true
      }
      hidden = true
      observedWindow.__chatUiPerf!.hidden = true
    } else if (options.resumeOnVisible) {
      reset()
      // Resume future turns, but do not relabel a tab return as a new document load.
      once.add("navigationToComposerInputMs")
      once.add("navigationToSendReadyMs")
      once.add("navigationToThreadFrameMs")
    }
  }
  const mutations = new MutationObserver(schedule)
  mutations.observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "disabled",
      "aria-disabled",
      "aria-label",
      "style",
      "hidden",
      "data-perf-text-length",
      "aria-expanded",
    ],
  })
  document.addEventListener("click", pointer, true)
  document.addEventListener("keydown", keydown, true)
  document.addEventListener("beforeinput", beforeinput, true)
  document.addEventListener("input", input, true)
  document.addEventListener("wheel", wheel, { capture: true, passive: true })
  document.addEventListener("scroll", scroll, { capture: true, passive: true })
  document.addEventListener("visibilitychange", visibility)
  for (const type of ["largest-contentful-paint", "event"] as const) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (type === "largest-contentful-paint")
          values.lcpMs = [entry.startTime]
        else record("eventTimingEntryMs", 0, entry.duration)
      }
    })
    observer.observe({
      type,
      buffered: true,
      ...(type === "event" ? { durationThreshold: 16 } : {}),
    })
    observers.push(observer)
  }
  observedWindow.__chatUiPerf = {
    values,
    hidden,
    reset,
    pendingDeltas: () => samples.length,
    droppedSamples: () => dropped,
    confirmSend() {
      if (sendCandidate === undefined) return
      beginSend(sendCandidate)
      sendCandidate = undefined
      clearTimeout(candidateTimer)
    },
    setPhase(next) {
      phase = next
    },
    bindStream() {
      const expectedTurn = turn
      const receive = observedWindow.__chatUiPerf!.receive
      return (type, length) => {
        if (turn === expectedTurn) receive(type, length)
      }
    },
    receive(type, length = 0) {
      if (sentAt === undefined) return
      if (type === "text-delta") {
        textLength += length
        const now = performance.now()
        if (now - sampledAt >= 250) {
          if (samples.length < 128)
            samples.push({ at: now, length: textLength, phase })
          else dropped++
          sampledAt = now
        }
      }
      if (type === "finish" || type === "error")
        terminalAt ??= performance.now()
      schedule()
    },
    dispose() {
      pendingWheel = undefined
      clearTimeout(candidateTimer)
      mutations.disconnect()
      observers.forEach((observer) => observer.disconnect())
      frames.forEach(cancelAnimationFrame)
      frameTasks.forEach(clearTimeout)
      frameTasks.clear()
      document.removeEventListener("click", pointer, true)
      document.removeEventListener("keydown", keydown, true)
      document.removeEventListener("beforeinput", beforeinput, true)
      document.removeEventListener("input", input, true)
      document.removeEventListener("wheel", wheel, true)
      document.removeEventListener("scroll", scroll, true)
      document.removeEventListener("visibilitychange", visibility)
      delete observedWindow.__chatUiPerf
    },
  }
}
