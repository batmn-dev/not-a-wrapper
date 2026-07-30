"use client"

import { ScrollButton } from "@/components/ui/scroll-button"
import { cn } from "@/lib/utils"
import { motion } from "motion/react"
import { forwardRef, type ReactNode } from "react"
import { THREAD_GUTTER_VARS, THREAD_MAXWIDTH_VARS } from "./thread-bounds"

type ThreadBottomContainerProps = {
  children: ReactNode
  className?: string
  isOnboarding?: boolean
}

/**
 * The measured sticky thread footer. Its three direct regions deliberately
 * separate non-interactive overflow/control layers from the interactive
 * composer column. The disclaimer lives in ThreadTail, outside this measured
 * footprint, so the scroll root reserves only the composer and its component
 * gap.
 */
const ThreadBottomContainer = forwardRef<
  HTMLDivElement,
  ThreadBottomContainerProps
>(function ThreadBottomContainer(
  { children, className, isOnboarding = false },
  ref
) {
  return (
    <div
      id="thread-bottom-container"
      ref={ref}
      className={cn(
        `group/thread-bottom-container pointer-events-none sticky bottom-[var(--screen-keyboard-height,0px)] isolate z-10 flex min-h-0 w-full basis-auto flex-col pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))] [--thread-component-gap:1.5rem] [--thread-scroll-control-offset:0.75rem] [--thread-scroll-to-bottom-banner-offset:0px] has-data-[has-thread-error]:pt-2 has-data-[has-thread-error]:[box-shadow:var(--sharp-edge-bottom-shadow)] max-sm:[--thread-scroll-control-offset:0.25rem] md:pt-0 print:hidden ${THREAD_GUTTER_VARS} ${THREAD_MAXWIDTH_VARS}`,
        isOnboarding ? "sm:grow" : "content-fade",
        className
      )}
    >
      <div
        data-thread-footer-overflow-spacer=""
        data-testid="thread-footer-overflow-spacer"
        aria-hidden="true"
        className="pointer-events-none"
      />

      <div
        data-thread-scroll-control-layer=""
        aria-hidden="true"
        className="pointer-events-none relative z-30 mx-auto h-0 w-full"
      >
        {!isOnboarding && (
          <div
            data-thread-scroll-control=""
            className="pointer-events-none absolute inset-x-0 flex justify-center"
            style={{
              bottom:
                "calc(var(--thread-scroll-control-offset) + var(--thread-scroll-to-bottom-banner-offset))",
            }}
          >
            <div
              data-thread-scroll-control-visibility=""
              className="pointer-events-auto flex group-[:not([data-scroll-from-end])]/scroll-root:pointer-events-none group-[:not([data-scroll-from-end])]/scroll-root:translate-y-2 group-[:not([data-scroll-from-end])]/scroll-root:scale-50 group-[:not([data-scroll-from-end])]/scroll-root:opacity-0 group-[:not([data-scroll-from-end])]/scroll-root:delay-0 group-[:not([data-scroll-from-end])]/scroll-root:duration-100 motion-safe:transition-all motion-safe:delay-300 motion-safe:duration-300 pointer-coarse:-m-1 pointer-coarse:p-1"
            >
              <ScrollButton />
            </div>
          </div>
        )}
      </div>

      <div
        data-thread-bottom-content=""
        className="mx-auto w-full px-[var(--thread-content-margin,1rem)] pb-[var(--thread-component-gap)]"
      >
        <div
          id="thread-bottom"
          className="pointer-events-auto mx-auto w-full max-w-[var(--thread-content-max-width,40rem)]"
        >
          {children}
        </div>
      </div>
    </div>
  )
})

function ThreadDisclaimer() {
  return (
    <motion.div
      data-thread-disclaimer=""
      data-testid="thread-disclaimer"
      initial={false}
      animate={{ height: "auto", opacity: 1, y: 0 }}
      exit={{ height: 0, opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="relative min-h-9 w-full overflow-hidden pt-2 pb-4 text-center text-xs md:px-[60px]"
    >
      <div
        className={`px-[var(--thread-content-margin,1rem)] ${THREAD_GUTTER_VARS}`}
      >
        <div
          className={`mx-auto w-full max-w-[var(--thread-content-max-width,40rem)] ${THREAD_MAXWIDTH_VARS}`}
        >
          <div className="bg-background pointer-events-auto mx-auto flex max-w-fit items-center justify-center rounded-full text-balance text-[var(--text-tertiary)] shadow-[0_0_8px_8px_var(--background)] select-none active:select-auto">
            Not A Wrapper can make mistakes. Check important info.
          </div>
        </div>
      </div>
    </motion.div>
  )
}

/**
 * The conversation's trailing gutter and disclaimer share one grid cell. The
 * disclaimer can therefore remain pinned immediately above the measured footer
 * without becoming part of its sticky-padding calculation.
 */
function ThreadTail({ children }: { children: ReactNode }) {
  return (
    <div data-thread-tail="" className="mt-auto grid">
      <div className="col-start-1 row-start-1">{children}</div>
      <div className="sticky bottom-[var(--scroll-root-safe-area-inset-bottom,0px)] col-start-1 row-start-1 self-end">
        <ThreadDisclaimer />
      </div>
    </div>
  )
}

export { ThreadBottomContainer, ThreadDisclaimer, ThreadTail }
