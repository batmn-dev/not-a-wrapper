"use client"

/**
 * ScrollRoot — the single thread scroll container and owner of the
 * `group/scroll-root` contract.
 *
 * There is deliberately NO JS stick-to-bottom controller here. The thread
 * controller performs one submit-time turn pin. Native scroll anchoring stays
 * enabled for settled reflow; active text growth disables it so Markdown
 * updates cannot replace the reader's manually chosen position.
 *
 * The element owns the CSS variable system every scroll policy derives from:
 *
 *   --sticky-padding-top                 header footprint (zeroed when the
 *                                        header goes fixed/transparent)
 *   --sticky-padding-bottom              JS-measured composer-stack footprint,
 *                                        written by useThreadViewportInsets
 *   --scroll-root-safe-area-inset-*      paddings + keyboard + env(safe-area)
 *   --scroll-root-safe-area-height       100lvh minus both insets — the usable
 *                                        thread viewport every `.threadScrollVars`
 *                                        formula (globals.css) divides up
 *
 * Turn sections carry `scroll-mt`/`scroll-mb` margins built on these variables
 * (see conversation.tsx), so positioning a turn is a single scrollIntoView call
 * — the browser does all the math.
 *
 * Runtime state the thread writes onto this element as attributes (consumed by
 * descendant CSS group variants, without React state):
 *   data-stream-active     while a turn is in flight
 *   data-scroll-from-end   while the bottom sentinel is out of view
 *   data-expanded-composer while the multiline composer owns the viewport
 *   data-voice-focus-mode  reserved for the full-screen voice surface
 *
 * ChatLayout preserves this element across `/` and `/c/...` handoffs, so its
 * keyboard controller and native scroll position survive route reconciliation.
 */
import { createKeyboardViewportController } from "@/components/ui/keyboard-viewport"
import { cn } from "@/lib/utils"
import { createContext, useCallback, useContext, useMemo, useRef } from "react"

type ScrollRootMode = "expanded-composer" | "voice-focus-mode"

type ScrollRootContextValue = {
  scrollRef: React.RefObject<HTMLDivElement | null>
  scrollToBottom: (behavior?: ScrollBehavior) => void
  setScrollRootMode: (mode: ScrollRootMode, active: boolean) => void
}

export const ScrollRootContext = createContext<ScrollRootContextValue | null>(
  null
)

type ScrollRootProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>

function ScrollRoot({ children, className, ...props }: ScrollRootProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const keyboardCleanupRef = useRef<(() => void) | null>(null)
  const setScrollRootRef = useCallback((node: HTMLDivElement | null) => {
    keyboardCleanupRef.current?.()
    keyboardCleanupRef.current = null
    scrollRef.current = node
    if (!node) return
    const keyboardCleanup = createKeyboardViewportController(node)
    // Reference `JAe` (conv.beauty.js:3873): the scroll root toggles
    // `data-scroll-from-top` (`scrollTop > 0`) — one initial rAF write plus a
    // passive scroll listener — and the mobile sticky header's under-scroll
    // shadow keys off it via `group-data-scroll-from-top/scroll-root`.
    const updateScrollFromTop = () => {
      node.toggleAttribute("data-scroll-from-top", node.scrollTop > 0)
    }
    const initialFrame = requestAnimationFrame(updateScrollFromTop)
    node.addEventListener("scroll", updateScrollFromTop, { passive: true })
    keyboardCleanupRef.current = () => {
      keyboardCleanup?.()
      cancelAnimationFrame(initialFrame)
      node.removeEventListener("scroll", updateScrollFromTop)
    }
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const setScrollRootMode = useCallback(
    (mode: ScrollRootMode, active: boolean) => {
      scrollRef.current?.toggleAttribute(`data-${mode}`, active)
    },
    []
  )

  const contextValue = useMemo<ScrollRootContextValue>(
    () => ({ scrollRef, scrollToBottom, setScrollRootMode }),
    [scrollToBottom, setScrollRootMode]
  )

  return (
    <ScrollRootContext.Provider value={contextValue}>
      <div
        ref={setScrollRootRef}
        data-scroll-root=""
        data-scrollable-surface=""
        className={cn(
          "@w-sm/main:[scrollbar-gutter:var(--stage-scroll-gutter)] touch:[scrollbar-width:none] group/scroll-root relative flex min-h-0 min-w-0 flex-1 [scrollbar-gutter:stable] flex-col not-print:overflow-x-clip not-print:overflow-y-auto data-stream-active:[overflow-anchor:none] not-print:data-expanded-composer:overflow-y-hidden! not-print:data-voice-focus-mode:overflow-y-hidden!",
          "scroll-pt-(--header-height) [--sticky-padding-bottom:0px] [--sticky-padding-top:var(--header-height)]",
          "[--scroll-root-safe-area-inset-top:calc(var(--sticky-padding-top)+env(safe-area-inset-top,0px))]",
          "[--scroll-root-safe-area-inset-bottom:calc(var(--sticky-padding-bottom)+var(--screen-keyboard-height,0px)+env(safe-area-inset-bottom,0px))]",
          "[--scroll-root-safe-area-height:calc(100lvh-var(--scroll-root-safe-area-inset-top)-var(--scroll-root-safe-area-inset-bottom))]",
          "has-data-[fixed-header=less-than-md]:md:scroll-pt-0 has-data-[fixed-header=less-than-md]:md:[--sticky-padding-top:0px]",
          "has-data-[fixed-header=never]:scroll-pt-0 has-data-[fixed-header=never]:[--sticky-padding-top:0px]",
          "has-data-[fixed-header=less-than-xl]:@w-xl/main:scroll-pt-0 has-data-[fixed-header=less-than-xl]:@w-xl/main:[--sticky-padding-top:0px]",
          "has-data-[fixed-header=less-than-xxl]:@w-2xl/main:scroll-pt-0 has-data-[fixed-header=less-than-xxl]:@w-2xl/main:[--sticky-padding-top:0px]",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </ScrollRootContext.Provider>
  )
}

function useScrollRoot() {
  const context = useContext(ScrollRootContext)
  if (!context) {
    throw new Error("useScrollRoot must be used within a <ScrollRoot> provider")
  }
  return context
}

function useOptionalScrollRoot() {
  return useContext(ScrollRootContext)
}

/**
 * Owns the thread viewport's measured inset inputs. The sticky footer writes
 * `--sticky-padding-bottom`; its stable keyboard pin writes
 * `--composer-height`. Everything downstream (safe-area height, response
 * height, keyboard placement, and the bottom sentinel's offset) derives from
 * those root-owned values in CSS.
 *
 * An absolutely positioned `[data-prompt-textarea-header]` sits outside normal
 * footer flow, so its measured height is first written to the stable overflow
 * spacer. The root measurement therefore includes the complete visible stack.
 *
 * Returns a ref callback for the sticky bottom container. The root publishes
 * the visible stack in every surface so composer growth and the first
 * onboarding-to-thread turn share one inset source.
 */
function useThreadViewportInsets() {
  const cleanupRef = useRef<(() => void) | null>(null)

  return useCallback((node: HTMLDivElement | null) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    if (!node) return
    const root = node.closest<HTMLElement>("[data-scroll-root]")
    if (!root) return
    const spacer = node.querySelector<HTMLElement>(
      "[data-thread-footer-overflow-spacer]"
    )
    const composer = node.querySelector<HTMLElement>(
      "[data-composer-keyboard-pin]"
    )
    let promptHeader = node.querySelector<HTMLElement>(
      "[data-prompt-textarea-header]"
    )

    const write = () => {
      const overflowHeight =
        promptHeader && getComputedStyle(promptHeader).position === "absolute"
          ? promptHeader.getBoundingClientRect().height
          : 0
      if (spacer) spacer.style.height = `${overflowHeight}px`
      root.style.setProperty(
        "--sticky-padding-bottom",
        `${node.getBoundingClientRect().height}px`
      )
      root.style.setProperty(
        "--composer-height",
        `${composer?.getBoundingClientRect().height ?? 0}px`
      )
    }

    write()
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(write)
    resizeObserver?.observe(node, { box: "border-box" })
    if (composer) resizeObserver?.observe(composer, { box: "border-box" })
    if (promptHeader)
      resizeObserver?.observe(promptHeader, { box: "border-box" })

    const mutationObserver = new MutationObserver(() => {
      if (promptHeader && node.contains(promptHeader)) return
      const nextHeader = node.querySelector<HTMLElement>(
        "[data-prompt-textarea-header]"
      )
      if (nextHeader === promptHeader) return
      if (promptHeader) resizeObserver?.unobserve(promptHeader)
      promptHeader = nextHeader
      if (promptHeader)
        resizeObserver?.observe(promptHeader, { box: "border-box" })
      write()
    })
    mutationObserver.observe(node, { childList: true, subtree: true })

    cleanupRef.current = () => {
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      spacer?.style.removeProperty("height")
      root.style.removeProperty("--sticky-padding-bottom")
      root.style.removeProperty("--composer-height")
    }
  }, [])
}

/** Compatibility name for non-thread callers that still measure one footer. */
const useStickyPaddingBottom = useThreadViewportInsets

export {
  ScrollRoot,
  useOptionalScrollRoot,
  useScrollRoot,
  useStickyPaddingBottom,
  useThreadViewportInsets,
}
