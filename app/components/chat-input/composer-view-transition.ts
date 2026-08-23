type ComposerViewTransition = {
  finished: Promise<unknown>
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ComposerViewTransition
}

const COMPOSER_SLIDE_TRANSITION_CLASS = "composer-slide-transition"

/**
 * Runs the first-turn surface flip through the browser's view-transition
 * callback. Unsupported browsers take the same synchronous update path and
 * receive no transition-only CSS variables.
 */
function runComposerSlideTransition(update: () => void) {
  const transitionDocument = document as ViewTransitionDocument
  const startViewTransition = transitionDocument.startViewTransition
  if (!startViewTransition) {
    update()
    return
  }

  const root = document.documentElement
  let updateStarted = false
  root.classList.add(COMPOSER_SLIDE_TRANSITION_CLASS)

  try {
    const transition = startViewTransition.call(transitionDocument, () => {
      updateStarted = true
      update()
    })
    void transition.finished
      .catch(() => undefined)
      .finally(() => root.classList.remove(COMPOSER_SLIDE_TRANSITION_CLASS))
  } catch {
    root.classList.remove(COMPOSER_SLIDE_TRANSITION_CLASS)
    if (!updateStarted) update()
  }
}

export { COMPOSER_SLIDE_TRANSITION_CLASS, runComposerSlideTransition }
