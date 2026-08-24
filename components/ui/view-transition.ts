type BrowserViewTransition = {
  finished: Promise<unknown>
  ready?: Promise<unknown>
  skipTransition?: () => void
  updateCallbackDone?: Promise<unknown>
}

type ViewTransitionOptions = {
  update: () => void
  types: string[]
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (
    update: (() => void) | ViewTransitionOptions
  ) => BrowserViewTransition
}

type RunViewTransitionOptions = {
  update: () => void
  className?: string | readonly string[]
  types?: readonly string[]
}

function settledTransition(): BrowserViewTransition {
  return {
    finished: Promise.resolve(),
    ready: Promise.resolve(),
    skipTransition: () => {},
    updateCallbackDone: Promise.resolve(),
  }
}

/**
 * The shared browser View Transition module. It owns feature detection, hidden
 * document behavior, typed transition metadata, root lifecycle state, and
 * failure-safe cleanup so product callers only provide their atomic update.
 */
function runViewTransition({
  update,
  className,
  types = [],
}: RunViewTransitionOptions): BrowserViewTransition {
  const transitionDocument = document as ViewTransitionDocument
  const startViewTransition = transitionDocument.startViewTransition

  if (document.visibilityState === "hidden" || !startViewTransition) {
    update()
    return settledTransition()
  }

  const root = document.documentElement
  const scopedClasses = Array.isArray(className)
    ? [...className]
    : className
      ? [className]
      : []
  const lifecycleClasses = ["active-view-transition", ...scopedClasses]
  let updateStarted = false
  let cleaned = false

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    root.classList.remove(...lifecycleClasses, "update-callback-done")
    root.removeAttribute("active-view-transition-type")
  }

  root.classList.add(...lifecycleClasses)
  if (types.length > 0) {
    root.setAttribute("active-view-transition-type", types.join(","))
  }

  const runUpdate = () => {
    updateStarted = true
    root.classList.add("update-callback-done")
    update()
  }

  try {
    const transition =
      types.length > 0 && "ViewTransitionTypeSet" in transitionDocument
        ? startViewTransition.call(transitionDocument, {
            update: runUpdate,
            types: [...types],
          })
        : startViewTransition.call(transitionDocument, runUpdate)

    void transition.ready?.catch(() => undefined)
    void transition.finished.then(cleanup, cleanup)
    return transition
  } catch {
    cleanup()
    if (!updateStarted) update()
    return settledTransition()
  }
}

export {
  runViewTransition,
  type BrowserViewTransition,
  type RunViewTransitionOptions,
}
