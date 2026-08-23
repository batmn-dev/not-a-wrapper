"use client"

/**
 * Owns the thread tail's four coupled behaviors: bottom-distance state, a
 * self-sizing response gutter, submit-time pinning with a bounded mount retry,
 * and once-per-conversation scroll restoration. The gutter writes its raw
 * remaining height intentionally; negative CSS min-height values are ignored.
 * Restoration prefers a saved turn anchor (thread-scroll-anchors.ts) and falls
 * back to the bottom.
 */
import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import { useCallback, useEffect, useRef } from "react"
import { ThreadTail } from "./thread-bottom-container"
import { restoreThreadAnchor, saveThreadAnchor } from "./thread-scroll-anchors"

const GUTTER_THRESHOLDS = Array.from({ length: 101 }, (_, i) => i / 100)
const PIN_RETRY_TIMEOUT_MS = 10_000
/** Trailing-idle fallback for browsers without native `scrollend`. */
const SCROLL_IDLE_FALLBACK_MS = 150
/** Subpixel layout can leave a visually bottomed root within one CSS pixel. */
const SCROLL_END_EPSILON_PX = 1

function closestScrollRoot(el: Element | null): HTMLElement | null {
  return el?.closest<HTMLElement>("[data-scroll-root]") ?? null
}

function setScrollFromEnd(root: HTMLElement, scrolledFromEnd: boolean) {
  root.toggleAttribute("data-scroll-from-end", scrolledFromEnd)
}

function isAtScrollEnd(root: HTMLElement) {
  return (
    Math.abs(root.scrollHeight - root.scrollTop - root.clientHeight) <=
    SCROLL_END_EPSILON_PX
  )
}

function readPixelValue(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getScrollFromEndRootMargin(root: HTMLElement) {
  const footerHeight =
    root
      .querySelector<HTMLElement>("#thread-bottom-container")
      ?.getBoundingClientRect().height ?? 0
  const keyboardHeight = readPixelValue(
    root.style.getPropertyValue("--screen-keyboard-height")
  )
  return `0px 0px ${footerHeight + keyboardHeight}px`
}

function pinTurn(root: HTMLElement, turnId: string): boolean {
  const turn = root.querySelector<HTMLElement>(
    `[data-turn-id="${CSS.escape(turnId)}"]`
  )
  if (turn == null) return false
  setScrollFromEnd(root, false)
  turn.scrollIntoView({ behavior: "instant", block: "end" })
  return true
}

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
  /** The active user turn to pin near the top of the viewport, set as soon as
   * its optimistic row is rendered. */
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

  // (1) The at-end sentinel: `data-scroll-from-end` on the root whenever the
  // sentinel is beyond the actual sticky footer/keyboard footprint. The
  // observer is rebuilt when that footprint changes, so compact, mobile,
  // attachment, error, and multiline composer states share one threshold.
  const sentinelCleanupRef = useRef<(() => void) | null>(null)
  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    sentinelCleanupRef.current?.()
    sentinelCleanupRef.current = null
    const root = closestScrollRoot(el)
    if (!el || !root) return
    rootRef.current = root

    let footer = root.querySelector<HTMLElement>("#thread-bottom-container")
    let observer: IntersectionObserver | null = null
    let rootMargin = ""

    const observeSentinel = () => {
      const nextRootMargin = getScrollFromEndRootMargin(root)
      if (observer && nextRootMargin === rootMargin) return
      observer?.disconnect()
      rootMargin = nextRootMargin
      observer = new IntersectionObserver(
        (entries) => {
          const { isIntersecting } = entries[entries.length - 1]
          setScrollFromEnd(root, !isIntersecting)
        },
        { root, rootMargin }
      )
      observer.observe(el)
    }

    const resizeObserver = new ResizeObserver(observeSentinel)
    resizeObserver.observe(root)
    if (footer) resizeObserver.observe(footer)

    let footerRefreshFrame: number | null = null
    const childObserver = new MutationObserver(() => {
      if (footerRefreshFrame !== null) return
      footerRefreshFrame = requestAnimationFrame(() => {
        footerRefreshFrame = null
        const nextFooter = root.querySelector<HTMLElement>(
          "#thread-bottom-container"
        )
        if (nextFooter === footer) return
        if (footer) resizeObserver.unobserve(footer)
        footer = nextFooter
        if (footer) resizeObserver.observe(footer)
        observeSentinel()
      })
    })
    childObserver.observe(root, { childList: true, subtree: true })

    const rootStyleObserver = new MutationObserver(observeSentinel)
    rootStyleObserver.observe(root, {
      attributes: true,
      attributeFilter: ["style"],
    })

    const viewport = window.visualViewport
    viewport?.addEventListener("resize", observeSentinel)
    viewport?.addEventListener("scroll", observeSentinel)

    observeSentinel()
    sentinelCleanupRef.current = () => {
      observer?.disconnect()
      resizeObserver.disconnect()
      childObserver.disconnect()
      if (footerRefreshFrame !== null) cancelAnimationFrame(footerRefreshFrame)
      rootStyleObserver.disconnect()
      viewport?.removeEventListener("resize", observeSentinel)
      viewport?.removeEventListener("scroll", observeSentinel)
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
    const observer = new IntersectionObserver(updateRemainingHeight, {
      root,
      threshold: GUTTER_THRESHOLDS,
    })
    observer.observe(el)
    const resizeObserver = new ResizeObserver(updateRemainingHeight)
    resizeObserver.observe(root)
    gutterCleanupRef.current = () => {
      observer.disconnect()
      resizeObserver.disconnect()
    }
  }, [])

  // (3) Stream lifecycle: `data-stream-active` gives descendants such as the
  // gutter and scroll control their streaming presentation, and lets the root
  // disable native scroll anchoring until the response settles. The one-shot
  // submit pin remains the sole owner of live-turn placement.
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

  // (4) Submit-time pinning before paint, with a bounded mount retry. Waiting
  // for another frame lets transient assistant DOM arrive before placement and
  // produces a visible second jump; the optimistic turn is already committed
  // when this layout lifecycle runs.
  useBrowserLayoutEffect(() => {
    if (!pinTurnId) {
      pinnedTurnRef.current = null
      return
    }
    const rootEl = rootRef.current
    if (!rootEl || pinnedTurnRef.current === pinTurnId) return

    // Optimistic insertion plus the response gutter normally places a send at
    // the intended edge in the same commit. Capture that state immediately:
    // streamed growth must not turn an already-correct placement into a second
    // scroll.
    if (isAtScrollEnd(rootEl)) {
      pinnedTurnRef.current = pinTurnId
      setScrollFromEnd(rootEl, false)
      return
    }

    pinnedTurnRef.current = pinTurnId
    if (pinTurn(rootEl, pinTurnId)) return
    return pinTurnWhenMounted(rootEl, pinTurnId)
  }, [pinTurnId])

  // (5) Load restore — once per conversation, instant, before paint. A saved
  // turn anchor wins; otherwise fall back to the bottom, repeated across two
  // frames to absorb late layout growth (images, markdown measurement).
  useBrowserLayoutEffect(() => {
    if (!hydrated) return
    if (restoredChatRef.current === chatId) return
    restoredChatRef.current = chatId
    if (freshChat || streamActive || pinnedTurnRef.current !== null) return
    const rootEl = rootRef.current
    if (!rootEl) return
    if (chatId !== null && restoreThreadAnchor(chatId, rootEl)) return
    const toBottom = () =>
      rootEl.scrollTo({ top: rootEl.scrollHeight, behavior: "instant" })
    toBottom()
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
  }, [hydrated, chatId, freshChat, streamActive])

  // (6) Anchor save — when the scroll settles, wait one frame for layout to
  // settle, then capture the top-visible turn into the module anchor map. A
  // later settle cancels and replaces a pending save. Cleanup never performs
  // a final save: navigating away before the scroll settles keeps the
  // previous settled anchor.
  useEffect(() => {
    const rootEl = rootRef.current
    if (!rootEl || chatId === null) return
    let frame: number | null = null
    let idleTimer: number | null = null
    const scheduleSave = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        saveThreadAnchor(chatId, rootEl)
      })
    }
    const supportsScrollEnd = "onscrollend" in window
    const onScroll = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(scheduleSave, SCROLL_IDLE_FALLBACK_MS)
    }
    if (supportsScrollEnd) {
      rootEl.addEventListener("scrollend", scheduleSave, { passive: true })
    } else {
      rootEl.addEventListener("scroll", onScroll, { passive: true })
    }
    return () => {
      if (supportsScrollEnd) {
        rootEl.removeEventListener("scrollend", scheduleSave)
      } else {
        rootEl.removeEventListener("scroll", onScroll)
      }
      if (idleTimer !== null) window.clearTimeout(idleTimer)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [chatId])

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
          aria-hidden="true"
          className="threadScrollVars pointer-events-none min-h-[var(--gutter-remaining-height,0px)] translate-y-(--scroll-root-safe-area-inset-bottom) group-data-stream-active/scroll-root:h-[calc(var(--thread-response-height)-16*var(--spacing))]"
        />
      </ThreadTail>
    </>
  )
}
