"use client"

/**
 * ScrollRoot — the single thread scroll container and owner of the
 * `group/scroll-root` contract.
 *
 * There is deliberately NO JS stick-to-bottom controller here. At rest, native
 * CSS scroll anchoring (`overflow-anchor: auto`, the default) keeps the
 * viewport stable through branch switches, panel reflows and late content;
 * it is disabled only while a turn streams, via the `data-stream-active`
 * attribute the thread lifecycle toggles on this element
 * (`data-stream-active:[overflow-anchor:none]`).
 *
 * The element owns the CSS variable system every scroll policy derives from:
 *
 *   --sticky-padding-top                 header footprint (zeroed when the
 *                                        header goes fixed/transparent)
 *   --sticky-padding-bottom              JS-measured composer-stack footprint,
 *                                        written inline by useStickyPaddingBottom
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
 * pure CSS group variants, without React state):
 *   data-stream-active     while a turn is in flight
 *   data-scroll-from-end   while the bottom sentinel is out of view
 */
import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import { cn } from "@/lib/utils"
import { createContext, useCallback, useContext, useMemo, useRef } from "react"

const MIN_VIRTUAL_KEYBOARD_HEIGHT = 80

type ScrollRootContextValue = {
  scrollRef: React.RefObject<HTMLDivElement | null>
  scrollToBottom: (behavior?: ScrollBehavior) => void
}

export const ScrollRootContext = createContext<ScrollRootContextValue | null>(
  null
)

type ScrollRootProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>

function isVirtualKeyboardTarget(element: Element | null) {
  return (
    element instanceof HTMLElement && element.dataset.virtualkeyboard === "true"
  )
}

/**
 * Keeps the scroll-root keyboard token tied to the visual viewport. The
 * editable element opts in with `data-virtualkeyboard="true"` so browser chrome
 * and pinch zoom never masquerade as an on-screen keyboard.
 */
function useScreenKeyboardHeight(
  scrollRef: React.RefObject<HTMLDivElement | null>
) {
  useBrowserLayoutEffect(() => {
    const root = scrollRef.current
    const viewport = window.visualViewport
    if (!root || !viewport) return

    let layoutViewportHeight = Math.max(
      window.innerHeight,
      document.documentElement.clientHeight,
      viewport.height + viewport.offsetTop
    )
    let frame: number | null = null

    const write = () => {
      frame = null
      const hasKeyboardTarget = isVirtualKeyboardTarget(document.activeElement)

      if (!hasKeyboardTarget) {
        layoutViewportHeight = Math.max(
          window.innerHeight,
          document.documentElement.clientHeight,
          viewport.height + viewport.offsetTop
        )
      }

      const obscuredHeight =
        hasKeyboardTarget && viewport.scale === 1
          ? Math.max(
              0,
              layoutViewportHeight - viewport.height - viewport.offsetTop
            )
          : 0
      const keyboardHeight =
        obscuredHeight >= MIN_VIRTUAL_KEYBOARD_HEIGHT ? obscuredHeight : 0

      root.style.setProperty(
        "--screen-keyboard-height",
        `${Math.round(keyboardHeight * 100) / 100}px`
      )
      root.toggleAttribute("data-keyboard-open", keyboardHeight > 0)
    }

    const scheduleWrite = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(write)
    }

    write()
    viewport.addEventListener("resize", scheduleWrite)
    viewport.addEventListener("scroll", scheduleWrite)
    window.addEventListener("resize", scheduleWrite)
    window.addEventListener("orientationchange", scheduleWrite)
    document.addEventListener("focusin", scheduleWrite)
    document.addEventListener("focusout", scheduleWrite)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      viewport.removeEventListener("resize", scheduleWrite)
      viewport.removeEventListener("scroll", scheduleWrite)
      window.removeEventListener("resize", scheduleWrite)
      window.removeEventListener("orientationchange", scheduleWrite)
      document.removeEventListener("focusin", scheduleWrite)
      document.removeEventListener("focusout", scheduleWrite)
      root.style.removeProperty("--screen-keyboard-height")
      root.removeAttribute("data-keyboard-open")
    }
  }, [scrollRef])
}

function ScrollRoot({ children, className, ...props }: ScrollRootProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useScreenKeyboardHeight(scrollRef)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const contextValue = useMemo<ScrollRootContextValue>(
    () => ({ scrollRef, scrollToBottom }),
    [scrollToBottom]
  )

  return (
    <ScrollRootContext.Provider value={contextValue}>
      <div
        ref={scrollRef}
        data-scroll-root=""
        className={cn(
          "group/scroll-root relative flex min-h-0 min-w-0 flex-1 [scrollbar-gutter:stable] flex-col overflow-x-clip overflow-y-auto",
          "data-stream-active:[overflow-anchor:none]",
          "scroll-pt-(--header-height) [--safe-area-inset-bottom:env(safe-area-inset-bottom,0px)] [--sticky-padding-bottom:var(--safe-area-inset-bottom)] [--sticky-padding-top:var(--header-height)]",
          "[--scroll-root-safe-area-inset-top:calc(var(--sticky-padding-top)+env(safe-area-inset-top,0px))]",
          "[--scroll-root-safe-area-inset-bottom:calc(var(--sticky-padding-bottom)+var(--screen-keyboard-height,0px))]",
          "[--scroll-root-safe-area-height:calc(100lvh-var(--scroll-root-safe-area-inset-top)-var(--scroll-root-safe-area-inset-bottom))]",
          "has-data-[fixed-header=less-than-xl]:@7xl/main:scroll-pt-0 has-data-[fixed-header=less-than-xl]:@7xl/main:[--sticky-padding-top:0px]",
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

/**
 * Measures the sticky composer stack (#thread-bottom-container) and writes its
 * footprint inline on the scroll root as `--sticky-padding-bottom` — the value
 * The value is set by a ResizeObserver writing
 * `getBoundingClientRect().height` inline. Everything downstream (safe-area
 * height, response height, the
 * bottom sentinel's offset) derives from it in CSS.
 *
 * An absolutely positioned `[data-prompt-textarea-header]` sits outside normal
 * footer flow, so its measured height is first written to the stable overflow
 * spacer. The root measurement therefore includes the complete visible stack.
 *
 * Returns a ref callback for the sticky bottom container. Pass
 * `enabled: false` while the composer is in its onboarding (grown/centered)
 * layout, where its height is not a thread inset.
 */
function useStickyPaddingBottom(enabled: boolean) {
  const cleanupRef = useRef<(() => void) | null>(null)

  return useCallback(
    (node: HTMLDivElement | null) => {
      cleanupRef.current?.()
      cleanupRef.current = null
      if (!node || !enabled) return
      const root = node.closest<HTMLElement>("[data-scroll-root]")
      if (!root) return
      const spacer = node.querySelector<HTMLElement>(
        "[data-thread-footer-overflow-spacer]"
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
      }

      write()
      const resizeObserver = new ResizeObserver(write)
      resizeObserver.observe(node, { box: "border-box" })
      if (promptHeader)
        resizeObserver.observe(promptHeader, { box: "border-box" })

      const mutationObserver = new MutationObserver(() => {
        if (promptHeader && node.contains(promptHeader)) return
        const nextHeader = node.querySelector<HTMLElement>(
          "[data-prompt-textarea-header]"
        )
        if (nextHeader === promptHeader) return
        if (promptHeader) resizeObserver.unobserve(promptHeader)
        promptHeader = nextHeader
        if (promptHeader)
          resizeObserver.observe(promptHeader, { box: "border-box" })
        write()
      })
      mutationObserver.observe(node, { childList: true, subtree: true })

      cleanupRef.current = () => {
        mutationObserver.disconnect()
        resizeObserver.disconnect()
        spacer?.style.removeProperty("height")
        root.style.removeProperty("--sticky-padding-bottom")
      }
    },
    [enabled]
  )
}

export { ScrollRoot, useScrollRoot, useStickyPaddingBottom }
