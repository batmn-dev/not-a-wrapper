import { noteChatProgrammaticScroll } from "@/lib/observability/chat-ui-events"

export type ThreadScrollTarget = {
  turnId: string
  messageId?: string
}

export type ThreadTargetAlignment =
  | { target: "none" }
  | { target: "turn" }
  | {
      target: "message"
      didScroll: boolean
      alignmentDelta: number
    }

export const THREAD_TARGET_HEADER_GAP_PX = 16
export const THREAD_TARGET_ALIGNMENT_EPSILON_PX = 2
export const THREAD_TARGET_MIN_TRACKING_MS = 350
export const THREAD_TARGET_STABLE_FRAME_COUNT = 3
export const THREAD_TARGET_TIMEOUT_MS = 1500

type AlignThreadTargetOptions = {
  allowTurnFallback?: boolean
  behavior?: ScrollBehavior
  forceAlignment?: boolean
}

type ResolveTurnScrollBehavior = (turn: HTMLElement) => ScrollBehavior

function scrollTargetTop(root: HTMLElement) {
  const scrollPaddingTop = Number.parseFloat(
    getComputedStyle(root).scrollPaddingTop
  )
  return (
    (Number.isFinite(scrollPaddingTop) ? scrollPaddingTop : 0) +
    THREAD_TARGET_HEADER_GAP_PX
  )
}

function isMessageVisible(root: HTMLElement, message: HTMLElement) {
  const messageRect = message.getBoundingClientRect()
  const rootRect = root.getBoundingClientRect()
  const visibleTop = rootRect.top + scrollTargetTop(root)
  const availableHeight = rootRect.bottom - visibleTop
  const visibleHeight =
    Math.min(messageRect.bottom, rootRect.bottom) -
    Math.max(messageRect.top, visibleTop)

  return (
    visibleHeight >=
    Math.min(messageRect.height, availableHeight) -
      THREAD_TARGET_ALIGNMENT_EPSILON_PX
  )
}

/** Align one semantic target using the recovered header gap and fallback. */
export function alignThreadScrollTarget(
  root: HTMLElement,
  target: ThreadScrollTarget,
  resolveBehavior: ResolveTurnScrollBehavior,
  options: AlignThreadTargetOptions = {}
): ThreadTargetAlignment {
  const message = target.messageId
    ? root.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(target.messageId)}"]`
      )
    : null
  const turn =
    options.allowTurnFallback === false
      ? null
      : root.querySelector<HTMLElement>(
          `[data-turn-id-container="${CSS.escape(target.turnId)}"]`
        )
  const scrollTarget = message ?? turn
  if (!scrollTarget) return { target: "none" }

  const behaviorTurn =
    root.querySelector<HTMLElement>(
      `[data-turn-id-container="${CSS.escape(target.turnId)}"]`
    ) ?? scrollTarget

  if (message && !options.forceAlignment && isMessageVisible(root, message)) {
    return { target: "message", didScroll: false, alignmentDelta: 0 }
  }

  const previousScrollMarginTop = message?.style.scrollMarginTop
  if (message) message.style.scrollMarginTop = `${scrollTargetTop(root)}px`

  noteChatProgrammaticScroll(root)
  scrollTarget.scrollIntoView({
    behavior: options.behavior ?? resolveBehavior(behaviorTurn),
    block: "start",
    inline: "nearest",
  })

  if (!message) return { target: "turn" }

  const alignmentDelta =
    message.getBoundingClientRect().top -
    root.getBoundingClientRect().top -
    scrollTargetTop(root)
  if (Math.abs(alignmentDelta) > THREAD_TARGET_ALIGNMENT_EPSILON_PX) {
    noteChatProgrammaticScroll(root)
    root.scrollTo({
      left: root.scrollLeft,
      top: root.scrollTop + alignmentDelta,
    })
  }
  requestAnimationFrame(() => {
    message.style.scrollMarginTop = previousScrollMarginTop ?? ""
  })

  return { target: "message", didScroll: true, alignmentDelta }
}

/** Follow a late-mounting message through the bounded stability loop. */
export function followThreadScrollTarget(
  root: HTMLElement,
  target: ThreadScrollTarget,
  resolveBehavior: ResolveTurnScrollBehavior
) {
  let frame: number | null = null
  let timeout: number | null = null
  let alignmentStarted = false
  let useInstantBehavior = false
  let turnFallbackUsed = false
  let trackingStartedAt: number | null = null
  let stableFrameCount = 0
  let stopped = false

  const stop = () => {
    if (stopped) return
    stopped = true
    if (frame !== null) cancelAnimationFrame(frame)
    if (timeout !== null) window.clearTimeout(timeout)
    frame = null
    timeout = null
  }

  const align = () => {
    const result = alignThreadScrollTarget(root, target, resolveBehavior, {
      allowTurnFallback: target.messageId === undefined || !turnFallbackUsed,
      behavior: useInstantBehavior ? "instant" : undefined,
      forceAlignment: alignmentStarted,
    })

    if (target.messageId === undefined) return result.target !== "none"
    if (result.target === "turn") {
      turnFallbackUsed = true
      stableFrameCount = 0
      return false
    }
    if (result.target === "message") {
      if (!result.didScroll) return true
      alignmentStarted = true
      useInstantBehavior = true
      trackingStartedAt ??= performance.now()
      stableFrameCount =
        Math.abs(result.alignmentDelta) <= THREAD_TARGET_ALIGNMENT_EPSILON_PX
          ? stableFrameCount + 1
          : 0
      return (
        performance.now() - trackingStartedAt >=
          THREAD_TARGET_MIN_TRACKING_MS &&
        stableFrameCount >= THREAD_TARGET_STABLE_FRAME_COUNT
      )
    }
    stableFrameCount = 0
    return false
  }

  const follow = () => {
    if (stopped) return
    if (align()) {
      stop()
      return
    }
    frame = requestAnimationFrame(follow)
  }

  if (!align()) frame = requestAnimationFrame(follow)
  timeout = window.setTimeout(stop, THREAD_TARGET_TIMEOUT_MS)
  return stop
}
