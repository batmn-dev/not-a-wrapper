"use client"

/**
 * Owns the thread tail's bottom-distance state, self-sizing response gutter,
 * and once-per-conversation scroll restoration. Submit placement belongs to
 * the active user turn through useSubmitTurnScrollRef, matching the component
 * that owns the target DOM node. The gutter writes its raw remaining height;
 * negative CSS min-height values are ignored.
 */
import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import { useCallback, useRef, useState } from "react"
import { ThreadTail } from "./thread-bottom-container"
import { restoreThreadAnchor, saveThreadAnchor } from "./thread-scroll-anchors"
import {
  followThreadScrollTarget,
  type ThreadScrollTarget,
} from "./thread-scroll-target"

const GUTTER_THRESHOLDS = Array.from({ length: 101 }, (_, i) => i / 100)
/** The reference polyfill's quiet window before a synthetic `scrollend`. */
const SCROLLEND_POLYFILL_QUIET_MS = 100

/**
 * Active-touch tracking for the `scrollend` fallback, ported from the
 * reference's lazily-loaded polyfill chunk (3e4a3e29-jukhsskidtr7106e.js): a
 * document-level set of touch identifiers, installed once and kept for the
 * page's lifetime, exactly like the polyfill's own document listeners.
 */
let activeTouchIdentifiers: Set<number> | null = null

function ensureTouchTracking(): Set<number> {
  if (activeTouchIdentifiers) return activeTouchIdentifiers
  const touches = new Set<number>()
  activeTouchIdentifiers = touches
  document.addEventListener(
    "touchstart",
    (event) => {
      for (const touch of event.changedTouches) touches.add(touch.identifier)
    },
    { passive: true }
  )
  const release = (event: TouchEvent) => {
    for (const touch of event.changedTouches) touches.delete(touch.identifier)
  }
  document.addEventListener("touchend", release, { passive: true })
  document.addEventListener("touchcancel", release, { passive: true })
  return touches
}

/**
 * `scrollend` with the reference's exact fallback semantics: native events
 * when supported; otherwise a 100ms scroll-quiet timer that re-arms while any
 * touch is active, so the event never fires mid-gesture — only after the last
 * finger lifts and scrolling has been quiet for the window.
 */
export function addScrollEndListener(
  target: HTMLElement,
  listener: () => void
): () => void {
  if ("onscrollend" in window) {
    target.addEventListener("scrollend", listener, { passive: true })
    return () => target.removeEventListener("scrollend", listener)
  }
  const touches = ensureTouchTracking()
  let timer: number | null = null
  const onScroll = () => {
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      if (touches.size) {
        timer = window.setTimeout(onScroll, SCROLLEND_POLYFILL_QUIET_MS)
      } else {
        timer = null
        listener()
      }
    }, SCROLLEND_POLYFILL_QUIET_MS)
  }
  target.addEventListener("scroll", onScroll, { passive: true })
  return () => {
    target.removeEventListener("scroll", onScroll)
    if (timer !== null) window.clearTimeout(timer)
  }
}
export const CHATGPT_TURN_INTERSECTION_EXPERIMENT = {
  id: "1841171328",
  key: "is_enabled",
  defaultValue: false,
  // The shipped code default: `Jo('1841171328').get('is_enabled', !1)`. Local
  // has no Statsig namespace, so the bundle's hardcoded default (control arm)
  // is authoritative: eager turns + assistant content-visibility. The
  // treatment arm's reflow correction writes scrollTop while placeholders
  // materialize above the viewport, which cancels in-flight touch momentum —
  // an upward flick through unvisited turns dies at each materialization.
  enabled: false,
} as const

export const TURN_RENDER_INTERSECTION_ROOT_MARGIN = "1000px 0px 1000px 0px"
export const TURN_RENDER_INTERSECTION_THRESHOLD = 0.01
export const TURN_CENTER_INTERSECTION_ROOT_MARGIN = "-49% 0px -49% 0px"
export const TURN_CENTER_INTERSECTION_THRESHOLD = 0
export const TURN_ALWAYS_RENDER_COUNT = 5
export const TURN_ACTIVE_RENDER_RADIUS = 5
export const TURN_REFLOW_EDGE_INSET_PX = 4
export const TURN_ESTIMATE_MOBILE_CHARACTERS_PER_LINE = 46
export const TURN_ESTIMATE_DESKTOP_CHARACTERS_PER_LINE = 88
export const TURN_ESTIMATE_LINE_HEIGHT_PX = 18
export const TURN_ESTIMATE_BASE_HEIGHT_PX = 56
export const TURN_ESTIMATE_MAX_HEIGHT_PX = 100_000

type TurnIntersectionChange = (
  intersecting: boolean,
  entry?: IntersectionObserverEntry
) => void

export type TurnIntersectionObserver = {
  observe: (turn: HTMLElement, onChange: TurnIntersectionChange) => () => void
  disconnect: () => void
}

/** Shares one observer per scroll root and one callback registry per target. */
export function createTurnIntersectionObserver({
  rootMargin = TURN_RENDER_INTERSECTION_ROOT_MARGIN,
  threshold = TURN_RENDER_INTERSECTION_THRESHOLD,
}: {
  rootMargin?: string
  threshold?: number
} = {}): TurnIntersectionObserver {
  const roots = new Map<
    HTMLElement,
    {
      callbacks: Map<HTMLElement, TurnIntersectionChange>
      observer: IntersectionObserver
    }
  >()

  return {
    observe(turn, onChange) {
      const root = closestScrollRoot(turn)
      if (!root || typeof IntersectionObserver === "undefined") {
        onChange(true)
        return () => undefined
      }

      let observation = roots.get(root)
      if (!observation) {
        const callbacks = new Map<HTMLElement, TurnIntersectionChange>()
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!(entry.target instanceof HTMLElement)) continue
              callbacks.get(entry.target)?.(
                entry.isIntersecting && entry.intersectionRatio >= threshold,
                entry
              )
            }
          },
          { root, rootMargin, threshold }
        )
        observation = { callbacks, observer }
        roots.set(root, observation)
      }

      observation.callbacks.set(turn, onChange)
      observation.observer.observe(turn)
      return () => {
        const current = roots.get(root)
        if (!current || current.callbacks.get(turn) !== onChange) return
        current.callbacks.delete(turn)
        current.observer.unobserve(turn)
        if (current.callbacks.size === 0) {
          current.observer.disconnect()
          roots.delete(root)
        }
      }
    },
    disconnect() {
      for (const { callbacks, observer } of roots.values()) {
        callbacks.clear()
        observer.disconnect()
      }
      roots.clear()
    },
  }
}

export function createTurnRenderIntersectionObserver() {
  return createTurnIntersectionObserver()
}

export function createTurnCenterIntersectionObserver() {
  return createTurnIntersectionObserver({
    rootMargin: TURN_CENTER_INTERSECTION_ROOT_MARGIN,
    threshold: TURN_CENTER_INTERSECTION_THRESHOLD,
  })
}

export function isTurnAlwaysRendered(
  index: number,
  turnCount: number,
  activeTurnIndex: number
) {
  return (
    index >= turnCount - TURN_ALWAYS_RENDER_COUNT ||
    (activeTurnIndex !== -1 &&
      Math.abs(index - activeTurnIndex) <= TURN_ACTIVE_RENDER_RADIUS)
  )
}

export function estimateTurnPlaceholderHeight(
  textParts: readonly string[],
  charactersPerLine: number
): number | null {
  let lineCount = 0

  for (const text of textParts) {
    if (text.length === 0) continue
    let lineStart = 0
    while (lineStart <= text.length) {
      const newline = text.indexOf("\n", lineStart)
      const lineEnd = newline === -1 ? text.length : newline
      const carriageReturn = Number(
        lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 13
      )
      lineCount += Math.max(
        1,
        Math.ceil((lineEnd - lineStart - carriageReturn) / charactersPerLine)
      )
      if (newline === -1) break
      lineStart = newline + 1
    }
  }

  return lineCount === 0
    ? null
    : Math.min(
        TURN_ESTIMATE_MAX_HEIGHT_PX,
        TURN_ESTIMATE_BASE_HEIGHT_PX + lineCount * TURN_ESTIMATE_LINE_HEIGHT_PX
      )
}

export type TurnReflowAnchor = {
  root: HTMLElement
  turnId: string
  edge: "top" | "bottom"
  edgePosition: number
}

export function captureTurnReflowAnchor(
  root: HTMLElement
): TurnReflowAnchor | null {
  const rootRect = root.getBoundingClientRect()
  const intersectingTurns = root.querySelectorAll<HTMLElement>(
    '[data-is-intersecting="true"]'
  )

  for (const turn of intersectingTurns) {
    const rect = turn.getBoundingClientRect()
    const turnId = turn.dataset.turnIdContainer
    if (!turnId) continue

    if (
      (rect.top < rootRect.top && rect.bottom > rootRect.bottom) ||
      (rect.top >= rootRect.top &&
        rect.top < rootRect.bottom - TURN_REFLOW_EDGE_INSET_PX)
    ) {
      return {
        root,
        turnId,
        edge: "top",
        edgePosition: rect.top,
      }
    }

    if (
      rect.bottom > rootRect.top + TURN_REFLOW_EDGE_INSET_PX &&
      rect.bottom <= rootRect.bottom
    ) {
      return {
        root,
        turnId,
        edge: "bottom",
        edgePosition: rect.bottom,
      }
    }
  }

  return null
}

export function restoreTurnReflowAnchor(anchor: TurnReflowAnchor): void {
  const turn = anchor.root.querySelector<HTMLElement>(
    `[data-turn-id-container="${CSS.escape(anchor.turnId)}"]`
  )
  if (!turn) return
  const rect = turn.getBoundingClientRect()
  const nextEdge = anchor.edge === "top" ? rect.top : rect.bottom
  const delta = nextEdge - anchor.edgePosition
  if (delta > 0) anchor.root.scrollTop += delta
}

export function useConversationTurnVirtualization(
  forceRenderedTurnId?: string | null
) {
  const [renderIntersectionObserver] = useState(
    createTurnRenderIntersectionObserver
  )
  const [centerIntersectionObserver] = useState(
    createTurnCenterIntersectionObserver
  )
  const markerNodeRef = useRef<HTMLSpanElement | null>(null)
  const intersectionsRef = useRef(new Map<string, boolean>())
  const reflowAnchorRef = useRef<TurnReflowAnchor | null>(null)
  const reflowCapturedRef = useRef(false)
  const [layoutVersion, setLayoutVersion] = useState(0)

  useBrowserLayoutEffect(() => {
    reflowCapturedRef.current = false
    const anchor = reflowAnchorRef.current
    reflowAnchorRef.current = null
    if (forceRenderedTurnId || !anchor) return
    restoreTurnReflowAnchor(anchor)
  }, [forceRenderedTurnId, layoutVersion])

  const captureReflowAnchor = useCallback(() => {
    if (reflowCapturedRef.current || reflowAnchorRef.current) return
    const marker = markerNodeRef.current
    const root =
      closestScrollRoot(marker) ??
      document.querySelector<HTMLElement>("[data-scroll-root]")
    if (!root) return
    reflowCapturedRef.current = true
    reflowAnchorRef.current = captureTurnReflowAnchor(root)
  }, [])

  const onIntersectingChange = useCallback(
    (
      turnId: string,
      intersecting: boolean,
      entry?: IntersectionObserverEntry
    ) => {
      const intersections = intersectionsRef.current
      if (intersections.get(turnId) === intersecting) return
      intersections.set(turnId, intersecting)
      if (forceRenderedTurnId || !entry) return

      const root =
        intersecting && entry.rootBounds
          ? closestScrollRoot(markerNodeRef.current)
          : null
      if (
        intersecting &&
        entry.rootBounds &&
        root &&
        entry.boundingClientRect.top >= root.getBoundingClientRect().bottom
      ) {
        return
      }

      captureReflowAnchor()
      setLayoutVersion((version) => version + 1)
    },
    [captureReflowAnchor, forceRenderedTurnId]
  )

  const markerRef = useCallback(
    (node: HTMLSpanElement | null) => {
      markerNodeRef.current = node
      if (!node) return
      return () => {
        if (markerNodeRef.current === node) markerNodeRef.current = null
        renderIntersectionObserver.disconnect()
        centerIntersectionObserver.disconnect()
        intersectionsRef.current.clear()
        reflowAnchorRef.current = null
        reflowCapturedRef.current = false
      }
    },
    [centerIntersectionObserver, renderIntersectionObserver]
  )

  return {
    centerIntersectionObserver,
    markerRef,
    onIntersectingChange,
    renderIntersectionObserver,
  }
}

function closestScrollRoot(el: Element | null): HTMLElement | null {
  return el?.closest<HTMLElement>("[data-scroll-root]") ?? null
}

function setScrollFromEnd(root: HTMLElement, scrolledFromEnd: boolean) {
  root.toggleAttribute("data-scroll-from-end", scrolledFromEnd)
}

/**
 * The authenticated front end defaults to smooth scrolling. Its gated path
 * falls back to instant only when a non-intersecting turn separates the first
 * visible turn from the submit target.
 */
export function resolveSubmitTurnScrollBehavior(
  turn: HTMLElement,
  gapAwareBehaviorEnabled: boolean = CHATGPT_TURN_INTERSECTION_EXPERIMENT.enabled
): ScrollBehavior {
  if (!gapAwareBehaviorEnabled) return "smooth"
  const target = turn.closest<HTMLElement>(
    "[data-turn-id-container][data-is-intersecting]"
  )
  if (!target) return "smooth"
  const parent = target.parentElement
  if (!parent) return "instant"
  const turns = Array.from(parent.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && Boolean(element.dataset.turnIdContainer)
  )
  const firstIntersectingIndex = turns.findIndex(
    (element) => element.dataset.isIntersecting === "true"
  )
  const targetIndex = turns.findIndex((element) => element === target)
  if (firstIntersectingIndex === -1 || targetIndex === -1) return "instant"
  const start = Math.min(firstIntersectingIndex, targetIndex)
  const end = Math.max(firstIntersectingIndex, targetIndex)
  for (let index = start; index < end; index += 1) {
    if (turns[index]?.dataset.isIntersecting !== "true") return "instant"
  }
  return "smooth"
}

function scheduleSubmitTurnScroll(turn: HTMLElement) {
  let innerFrame: number | null = null
  const outerFrame = requestAnimationFrame(() => {
    innerFrame = requestAnimationFrame(() => {
      innerFrame = null
      const root = closestScrollRoot(turn)
      if (root) setScrollFromEnd(root, false)
      turn.scrollIntoView({
        behavior: resolveSubmitTurnScrollBehavior(turn),
        block: "end",
      })
    })
  })
  return () => {
    cancelAnimationFrame(outerFrame)
    if (innerFrame !== null) cancelAnimationFrame(innerFrame)
  }
}

/** The active final user turn owns submit placement and its exact timing. */
export function useSubmitTurnScrollRef(active: boolean) {
  return useCallback(
    (turn: HTMLElement | null) => {
      if (!active || !turn) return
      return scheduleSubmitTurnScroll(turn)
    },
    [active]
  )
}

/** Publishes the separate center-band intersection used by the table of
 * contents. Render/virtualization intersection remains owned by the outer
 * turn wrapper and is not overwritten by this observer. */
export function useTurnIntersectionRef(
  onChange?: (intersecting: boolean) => void
) {
  const [observer] = useState(createTurnCenterIntersectionObserver)
  return useCallback(
    (turn: HTMLElement | null) => {
      if (!turn || !onChange) return
      return observer.observe(turn, (intersecting) => onChange(intersecting))
    },
    [observer, onChange]
  )
}

type ThreadScrollEdgeProps = {
  chatId: string | null
  /** A turn is in flight (submitted or streaming) — mirrored onto the scroll
   * root as `data-stream-active`. */
  streamActive: boolean
  /** The conversation's messages are present (load restore waits for them). */
  hydrated: boolean
  /** This conversation was started in this session — its position came from
   * pinning, so the load restore must not run. */
  freshChat: boolean
  /** Optional route target. Message alignment wins; the containing turn is
   * the late-mount fallback while hydration converges. */
  scrollTarget?: ThreadScrollTarget | null
  /** A deep-link param was present at load, resolvable or not. The reference
   * restore gate keys on raw param presence (conv.beauty.js:180547), so an
   * unresolvable link still suppresses the default bottom restore. */
  deepLink?: boolean
}

export function ThreadScrollEdge({
  chatId,
  streamActive,
  hydrated,
  freshChat,
  scrollTarget,
  deepLink = false,
}: ThreadScrollEdgeProps) {
  const rootRef = useRef<HTMLElement | null>(null)
  const restoredChatRef = useRef<string | null | false>(false)

  // Per-conversation reset for pushState transitions that keep this component
  // mounted. The null → id handoff is the same conversation acquiring its
  // route (mirrors Chat's panel-reset rule).
  const chatKeyRef = useRef<string | null>(chatId)
  useBrowserLayoutEffect(() => {
    if (chatKeyRef.current === chatId) return
    chatKeyRef.current = chatId
  }, [chatId])

  // (1) The at-end sentinel uses the reference's fixed 96px observer margin.
  const sentinelCleanupRef = useRef<(() => void) | null>(null)
  const sentinelRef = useCallback(
    (el: HTMLDivElement | null) => {
      sentinelCleanupRef.current?.()
      sentinelCleanupRef.current = null
      const root = closestScrollRoot(el)
      if (!el || !root) return
      rootRef.current = root

      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1]
          if (entry) setScrollFromEnd(root, !entry.isIntersecting)
        },
        { root, rootMargin: "0px 0px 96px" }
      )
      observer.observe(el)

      let frame: number | null = null
      const scheduleSave = () => {
        if (chatId === null) return
        if (frame !== null) cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          frame = null
          saveThreadAnchor(chatId, root)
        })
      }
      const removeScrollEndListener =
        chatId !== null ? addScrollEndListener(root, scheduleSave) : null

      let cleaned = false
      const cleanup = () => {
        if (cleaned) return
        cleaned = true
        observer.disconnect()
        root.removeAttribute("data-scroll-from-end")
        removeScrollEndListener?.()
        if (frame !== null) cancelAnimationFrame(frame)
        if (sentinelCleanupRef.current === cleanup) {
          sentinelCleanupRef.current = null
        }
      }
      sentinelCleanupRef.current = cleanup
      return cleanup
    },
    [chatId]
  )

  // (2) The self-regulating gutter: min-height tracks the
  // viewport space below the gutter's own top edge, unclamped, in all states.
  const gutterCleanupRef = useRef<(() => void) | null>(null)
  const gutterRef = useCallback((el: HTMLDivElement | null) => {
    gutterCleanupRef.current?.()
    gutterCleanupRef.current = null
    const root = closestScrollRoot(el)
    if (!el || !root) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        const remaining =
          (entry.rootBounds?.bottom ?? root.getBoundingClientRect().bottom) -
          entry.boundingClientRect.top
        el.style.setProperty("--gutter-remaining-height", `${remaining}px`)
      },
      { root, threshold: GUTTER_THRESHOLDS }
    )
    observer.observe(el)
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      observer.disconnect()
      root.removeAttribute("data-stream-active")
      if (gutterCleanupRef.current === cleanup) gutterCleanupRef.current = null
    }
    gutterCleanupRef.current = cleanup
    return cleanup
  }, [])

  // (3) Stream lifecycle: `data-stream-active` gives descendants such as the
  // gutter and scroll control their streaming presentation. The root keeps
  // native scroll anchoring; virtualized replacement owns explicit correction.
  useBrowserLayoutEffect(() => {
    const rootEl = rootRef.current
    if (!rootEl) return
    if (streamActive) rootEl.setAttribute("data-stream-active", "")
    else rootEl.removeAttribute("data-stream-active")
  }, [streamActive])

  // (4) Semantic deep-link restoration. The first move may be smooth; late
  // DOM/height corrections are instant and stop after the recovered bounded
  // stability window.
  useBrowserLayoutEffect(() => {
    if (!hydrated || !scrollTarget) return
    const rootEl = rootRef.current
    if (!rootEl) return
    return followThreadScrollTarget(
      rootEl,
      scrollTarget,
      resolveSubmitTurnScrollBehavior
    )
  }, [hydrated, scrollTarget?.messageId, scrollTarget?.turnId])

  // (5) Load restore — once per conversation, instant, before paint. A saved
  // turn anchor wins; otherwise fall back to the bottom, repeated across two
  // frames to absorb late layout growth (images, markdown measurement).
  useBrowserLayoutEffect(() => {
    if (!hydrated) return
    if (restoredChatRef.current === chatId) return
    restoredChatRef.current = chatId
    if (freshChat || streamActive || scrollTarget || deepLink) return
    const rootEl = rootRef.current
    if (!rootEl) return
    if (chatId !== null && restoreThreadAnchor(chatId, rootEl)) return
    const toBottom = () => {
      rootEl.scrollTop = rootEl.scrollHeight
    }
    let frame: number | null = requestAnimationFrame(() => {
      toBottom()
      frame = requestAnimationFrame(() => {
        frame = null
        toBottom()
      })
    })
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [hydrated, chatId, freshChat, streamActive, scrollTarget, deepLink])

  return (
    <>
      <div
        ref={sentinelRef}
        aria-hidden="true"
        className="pointer-events-none -mt-px h-px translate-y-(--scroll-root-safe-area-inset-bottom)"
      />
      <ThreadTail>
        <div
          ref={gutterRef}
          className="threadScrollVars pointer-events-none min-h-[var(--gutter-remaining-height,0px)] translate-y-(--scroll-root-safe-area-inset-bottom) group-data-stream-active/scroll-root:h-[calc(var(--thread-response-height)-16*var(--spacing))]"
        />
      </ThreadTail>
    </>
  )
}
