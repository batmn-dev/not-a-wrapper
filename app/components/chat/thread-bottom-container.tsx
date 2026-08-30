"use client"

import { ScrollButton } from "@/components/ui/scroll-button"
import { useThreadViewportInsets } from "@/components/ui/scroll-root"
import { cn } from "@/lib/utils"
import { motion } from "motion/react"
import { forwardRef, useCallback, type ReactNode } from "react"
import type { ChatSurface } from "./chat-chrome"
import { THREAD_GUTTER_VARS, THREAD_MAXWIDTH_VARS } from "./thread-bounds"

/**
 * One source for the footer's gutter + centered-column math. Every column in
 * the sticky footer stack (the above-composer slot, the composer column, the
 * disclaimer) composes these two strings, so a future consumer cannot drift
 * the gutter or max-width tokens from the composer's. Kept as class constants
 * rather than a wrapper component: the composer column renders in both
 * posture branches, and a component appearing in only one branch would
 * remount the composer on posture changes (a pinned DOM-identity contract).
 */
const threadColumnGutterClassName = "px-[var(--thread-content-margin,1rem)]"
const threadColumnClassName =
  "mx-auto w-full max-w-[var(--thread-content-max-width,40rem)]"

type ThreadBottomContainerProps = {
  children: ReactNode
  className?: string
  /**
   * The resolved Chat surface from the ADR-0017 policy Module. This keeps
   * product posture out of the design-system primitives and prevents invalid
   * `variant` + `isOnboarding` flag combinations.
   */
  surface?: ChatSurface
  /**
   * System banners rendered above the composer inside the footer's fade
   * backdrop between the overflow spacer and the scroll control, including
   * "continue generating", error retries, and similar notices.
   */
  aboveComposer?: ReactNode
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
  { children, className, surface = "thread", aboveComposer },
  forwardedRef
) {
  const isProjectOnboarding = surface === "project-onboarding"
  const isOnboarding = surface !== "thread"
  const viewportInsetsRef = useThreadViewportInsets()
  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      viewportInsetsRef(node)
      if (typeof forwardedRef === "function") {
        forwardedRef(node)
      } else if (forwardedRef) {
        forwardedRef.current = node
      }
    },
    [forwardedRef, viewportInsetsRef]
  )
  return (
    <div
      id="thread-bottom-container"
      ref={setContainerRef}
      className={cn(
        isProjectOnboarding
          ? "group/thread-bottom-container fixed inset-x-4 bottom-0 z-30 mx-auto max-w-(--project-detail-composer-width) bg-[linear-gradient(to_top,var(--background)_75%,transparent)] pt-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] md:static md:inset-auto md:z-auto md:mt-6 md:w-full md:bg-none md:p-0 md:max-lg:px-4"
          : cn(
              `group/thread-bottom-container content-fade pointer-events-none sticky bottom-0 isolate z-10 flex min-h-0 w-full basis-auto flex-col [--thread-component-gap:1.5rem] [--thread-scroll-control-offset:1.5rem] [--thread-scroll-to-bottom-banner-offset:0px] has-data-[has-thread-error]:pt-2 has-data-[has-thread-error]:[box-shadow:var(--sharp-edge-bottom-shadow)] md:pt-0 print:hidden ${THREAD_GUTTER_VARS} ${THREAD_MAXWIDTH_VARS}`,
              isOnboarding && "sm:grow"
            ),
        className
      )}
    >
      <div
        data-thread-footer-overflow-spacer=""
        data-testid="thread-footer-overflow-spacer"
        aria-hidden="true"
        className="pointer-events-none"
      />

      <div data-thread-above-composer="" className="w-full">
        <div className={`mx-auto w-full ${threadColumnGutterClassName}`}>
          <div className={`pointer-events-auto ${threadColumnClassName}`}>
            <div
              data-thread-above-composer-slot=""
              className="pointer-events-auto mb-[var(--thread-component-gap)] w-full empty:hidden"
            >
              {aboveComposer}
            </div>
          </div>
        </div>
      </div>

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

      <div id="thread-bottom" className="relative w-full">
        <div
          data-thread-bottom-content=""
          className={
            isProjectOnboarding
              ? "w-full"
              : `relative z-1 mx-auto flex w-full flex-col ${threadColumnGutterClassName}`
          }
        >
          <div
            data-thread-composer-column=""
            className={
              isProjectOnboarding
                ? "pointer-events-auto w-full"
                : `pointer-events-auto mb-[var(--thread-component-gap)] ${threadColumnClassName}`
            }
          >
            <div
              data-composer-keyboard-pin=""
              className="keyboard-open:fixed keyboard-open:start-3 keyboard-open:end-3 keyboard-open:bottom-[var(--screen-keyboard-height,0px)] keyboard-open:z-50 keyboard-open:w-auto! keyboard-open:pb-2.5 relative [--keyboard-open-mask-bg:var(--background)]"
            >
              <div
                data-keyboard-open-mask=""
                aria-hidden="true"
                className="keyboard-open:block keyboard-open:-bottom-[var(--screen-keyboard-height,0px)] keyboard-open:bg-[linear-gradient(to_bottom,transparent,var(--keyboard-open-mask-bg)),linear-gradient(to_bottom,transparent_var(--single-line-fade-height),var(--keyboard-open-mask-bg)_var(--single-line-fade-height))] keyboard-open:bg-size-[100%_var(--single-line-fade-height),100%_100%] keyboard-open:bg-position-[top,bottom] keyboard-open:bg-no-repeat pointer-events-none absolute inset-x-0 top-0 -z-10 hidden h-full bg-transparent [--single-line-fade-height:32px]"
              />
              {children}
            </div>
          </div>
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
      // Key side padding to the 40rem thread container, not the viewport, so
      // it tracks the sidebar.
      className="relative min-h-9 w-full overflow-hidden pt-2 pb-4 text-center text-xs [view-transition-name:var(--vt-disclaimer)] @[40rem]/main:px-[60px]"
    >
      <div
        className={`${threadColumnGutterClassName} ${THREAD_GUTTER_VARS}`}
      >
        <div
          className={`${threadColumnClassName} ${THREAD_MAXWIDTH_VARS}`}
        >
          {/* Plain tertiary text lets the strip fade under the composer with
              everything else. */}
          <div className="pointer-events-auto mx-auto flex max-w-fit items-center justify-center text-balance text-[var(--text-tertiary)] select-none active:select-auto">
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
