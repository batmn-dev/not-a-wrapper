"use client"

import { useEffect } from "react"

/**
 * Zero-rerender scroll state tracking via data attributes.
 *
 * Sets `data-scrolled-from-top` and `data-scrolled-from-end` on the target
 * element based on scroll position. These attributes can be targeted with
 * Tailwind's `group-data-*` variants for CSS-only scroll indicators.
 *
 * Pattern borrowed from common scrollable sidebar behavior.
 *
 * @example
 * ```tsx
 * const scrollRef = useRef<HTMLElement>(null)
 * useScrollAttributes(scrollRef)
 *
 * <nav ref={scrollRef} className="group/scrollport overflow-y-auto">
 *   <div className="group-data-[scrolled-from-top]/scrollport:shadow-sm">
 *     Header with scroll shadow
 *   </div>
 * </nav>
 * ```
 */
export function useScrollAttributes(
  ref: React.RefObject<HTMLElement | null>,
  { threshold = 5 }: { threshold?: number } = {}
) {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el

      // Set/remove data-scrolled-from-top
      if (scrollTop > threshold) {
        el.dataset.scrolledFromTop = ""
      } else {
        delete el.dataset.scrolledFromTop
      }

      // Set/remove data-scrolled-from-end
      if (scrollTop + clientHeight < scrollHeight - threshold) {
        el.dataset.scrolledFromEnd = ""
      } else {
        delete el.dataset.scrolledFromEnd
      }
    }

    // Initial check
    update()

    // Scroll listener (passive for performance)
    el.addEventListener("scroll", update, { passive: true })

    // ResizeObserver for dynamic content changes (chat list loading, sections expanding)
    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(el)

    return () => {
      el.removeEventListener("scroll", update)
      resizeObserver.disconnect()
    }
  }, [ref, threshold])
}
