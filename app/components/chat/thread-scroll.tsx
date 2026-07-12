"use client"

/**
 * ThreadScrollEdge — the thread's tail elements and scroll lifecycle,
 * reproducing the captured reference behavior at the source level:
 *
 *  1. The 1px bottom sentinel. An IntersectionObserver with
 *     `rootMargin: "0px 0px 72px"` toggles `data-scroll-from-end` on the
 *     scroll root when the sentinel is NOT intersecting. That attribute is
 *     the whole "away from bottom" signal — the scroll pill shows/hides via
 *     pure CSS group variants on it; no React state, no scroll math.
 *
 *  2. The trailing gutter. A permanent IntersectionObserver on the gutter
 *     itself (101 thresholds), root = scroll root, writes
 *     `rootRect.bottom − gutterRect.top` (unclamped) into
 *     `--gutter-remaining-height` on every ratio change. Its `min-height`
 *     therefore self-regulates toward "fill the viewport below the content"
 *     in ALL states: it reserves the visible response space while streaming
 *     (the stream-height class wins whenever it is larger), decays live as
 *     the answer consumes it, freezes naturally at settle, keeps short
 *     threads at exactly one viewport, and absorbs branch-switch height
 *     deltas. Negative writes are intentional — an invalid min-height is
 *     ignored by CSS (the reference writes them raw; observed `-2474.84px`).
 *
 *  3. Answer-start pinning through a rAF-and-retry pipeline: clear
 *     `data-scroll-from-end`, `scrollIntoView({ block: "end" })` on
 *     `[data-turn-id="…"]`; if the turn is not mounted yet, retry from a
 *     childList MutationObserver with a timeout cap. Their `behavior` is
 *     feature-flagged instant-vs-smooth; the flag serves `instant` (measured
 *     live), so instant is hardcoded here.
 *
 *  4. Load restore — once per conversation, instant, before paint. The gutter
 *     needs no help: its observer sizes it at mount.
 */

import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import { useCallback, useEffect, useRef } from "react"

/** Sentinel observer margin below the scrollport (desktop mode). */
const SCROLL_FROM_END_ROOT_MARGIN = "0px 0px 72px"
/** Gutter observer thresholds — every percent of visibility. */
const GUTTER_THRESHOLDS = Array.from({ length: 101 }, (_, i) => i / 100)
/** Retry cap for a pin whose turn has not mounted yet (their `Btt`). */
const PIN_RETRY_TIMEOUT_MS = 10_000

function closestScrollRoot(el: Element | null): HTMLElement | null {
  return el?.closest<HTMLElement>("[data-scroll-root]") ?? null
}

/** Set the pill's visibility attribute on the scroll root. */
function setScrollFromEnd(root: HTMLElement, scrolledFromEnd: boolean) {
  root.toggleAttribute("data-scroll-from-end", scrolledFromEnd)
}

/** Resolve the turn and pin it; false when not mounted yet. */
function pinTurn(root: HTMLElement, turnId: string): boolean {
  const turn = root.querySelector<HTMLElement>(
    `[data-turn-id="${CSS.escape(turnId)}"]`
  )
  if (turn == null) return false
  setScrollFromEnd(root, false)
  turn.scrollIntoView({ behavior: "instant", block: "end" })
  return true
}

/** Retry the pin as the turn mounts, capped by a timeout. */
function pinTurnWhenMounted(root: HTMLElement, turnId: string): () => void {
  const observer = new MutationObserver(() => {
    if (pinTurn(root, turnId)) {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  })
  observer.observe(root, { childList: true, subtree: true })
  const timer = window.setTimeout(
    () => observer.disconnect(),
    PIN_RETRY_TIMEOUT_MS
  )
  return () => {
    observer.disconnect()
    window.clearTimeout(timer)
  }
}

type ThreadScrollEdgeProps = {
  chatId: string | null
  /** A turn is in flight (submitted or streaming) — mirrored onto the scroll
   * root as `data-stream-active`. */
  streamActive: boolean
  /** The user turn to pin near the top of the viewport, set at answer-start
   * (Conversation withholds it until the response's first text). */
  pinTurnId: string | null
  /** The conversation's messages are present (load restore waits for them). */
  hydrated: boolean
  /** This conversation was started in this session — its position came from
   * pinning, so the load restore must not run. */
  freshChat: boolean
}

export function ThreadScrollEdge({
  chatId,
  streamActive,
  pinTurnId,
  hydrated,
  freshChat,
}: ThreadScrollEdgeProps) {
  const rootRef = useRef<HTMLElement | null>(null)
  const pinnedTurnRef = useRef<string | null>(null)
  const restoredChatRef = useRef<string | null | false>(false)

  // Per-conversation reset for pushState transitions that keep this component
  // mounted. The null → id handoff is the same conversation acquiring its
  // route (mirrors Chat's panel-reset rule), so it keeps the pin state.
  // Declared FIRST so it runs before the pin/restore effects in each commit.
  const chatKeyRef = useRef<string | null>(chatId)
  useBrowserLayoutEffect(() => {
    if (chatKeyRef.current === chatId) return
    if (chatKeyRef.current !== null) pinnedTurnRef.current = null
    chatKeyRef.current = chatId
  }, [chatId])

  // (1) The at-end sentinel: `data-scroll-from-end` on the
  // root whenever the sentinel is not within 72px below the scrollport.
  const sentinelCleanupRef = useRef<(() => void) | null>(null)
  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    sentinelCleanupRef.current?.()
    sentinelCleanupRef.current = null
    const root = closestScrollRoot(el)
    if (!el || !root) return
    rootRef.current = root
    const observer = new IntersectionObserver(
      (entries) => {
        const { isIntersecting } = entries[entries.length - 1]
        setScrollFromEnd(root, !isIntersecting)
      },
      { root, rootMargin: SCROLL_FROM_END_ROOT_MARGIN }
    )
    observer.observe(el)
    sentinelCleanupRef.current = () => {
      observer.disconnect()
      root.removeAttribute("data-scroll-from-end")
    }
  }, [])

  // (2) The self-regulating gutter: min-height tracks the
  // viewport space below the gutter's own top edge, unclamped, in all states.
  const gutterCleanupRef = useRef<(() => void) | null>(null)
  const gutterRef = useCallback((el: HTMLDivElement | null) => {
    gutterCleanupRef.current?.()
    gutterCleanupRef.current = null
    const root = closestScrollRoot(el)
    if (!el || !root) return
    const updateRemainingHeight = () => {
      const remaining =
        root.getBoundingClientRect().bottom - el.getBoundingClientRect().top
      el.style.setProperty("--gutter-remaining-height", `${remaining}px`)
    }
    const observer = new IntersectionObserver(
      updateRemainingHeight,
      { root, threshold: GUTTER_THRESHOLDS }
    )
    observer.observe(el)
    const resizeObserver = new ResizeObserver(updateRemainingHeight)
    resizeObserver.observe(root)
    gutterCleanupRef.current = () => {
      observer.disconnect()
      resizeObserver.disconnect()
    }
  }, [])

  // (3) Stream lifecycle: `data-stream-active` on the root gives the gutter
  // its reserved-space height class and disables native scroll anchoring
  // (both pure CSS). The gutter's observers handle everything else.
  useBrowserLayoutEffect(() => {
    const rootEl = rootRef.current
    if (!rootEl) return
    if (streamActive) rootEl.setAttribute("data-stream-active", "")
    else rootEl.removeAttribute("data-stream-active")
  }, [streamActive])

  // The scroll root outlives this thread (it lives in the layout) — never
  // leave the attribute behind when the conversation unmounts mid-stream.
  useEffect(() => {
    return () => {
      rootRef.current?.removeAttribute("data-stream-active")
      sentinelCleanupRef.current?.()
      gutterCleanupRef.current?.()
    }
  }, [])

  // (4) Answer-start pinning through the rAF + retry pipeline.
  useEffect(() => {
    if (!pinTurnId) {
      pinnedTurnRef.current = null
      return
    }
    const rootEl = rootRef.current
    if (!rootEl || pinnedTurnRef.current === pinTurnId) return
    let cancelRetry: (() => void) | null = null
    const frame = requestAnimationFrame(() => {
      pinnedTurnRef.current = pinTurnId
      if (!pinTurn(rootEl, pinTurnId)) {
        cancelRetry = pinTurnWhenMounted(rootEl, pinTurnId)
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      cancelRetry?.()
    }
  }, [pinTurnId])

  // (5) Load restore — once per conversation, instant, before paint.
  useBrowserLayoutEffect(() => {
    if (!hydrated) return
    if (restoredChatRef.current === chatId) return
    restoredChatRef.current = chatId
    if (freshChat || streamActive || pinnedTurnRef.current !== null) return
    const rootEl = rootRef.current
    if (!rootEl) return
    rootEl.scrollTo({ top: rootEl.scrollHeight, behavior: "instant" })
  }, [hydrated, chatId, freshChat, streamActive])

  return (
    <>
      <div
        ref={sentinelRef}
        aria-hidden="true"
        className="pointer-events-none -mt-px h-px translate-y-(--scroll-root-safe-area-inset-bottom)"
      />
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="threadScrollVars pointer-events-none min-h-[var(--gutter-remaining-height,0px)] translate-y-(--scroll-root-safe-area-inset-bottom) group-data-stream-active/scroll-root:h-[calc(var(--thread-response-height)-16*var(--spacing))]"
      />
    </>
  )
}
