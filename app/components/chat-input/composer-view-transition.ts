import { runViewTransition } from "@/components/ui/view-transition"

const COMPOSER_SLIDE_TRANSITION_CLASS = "composer-slide-transition"

/**
 * Runs the first-turn surface flip through the browser's view-transition
 * callback. Unsupported browsers take the same synchronous update path and
 * receive no transition-only CSS variables.
 */
function runComposerSlideTransition(update: () => void) {
  return runViewTransition({
    update,
    className: COMPOSER_SLIDE_TRANSITION_CLASS,
    types: ["composer"],
  })
}

export { COMPOSER_SLIDE_TRANSITION_CLASS, runComposerSlideTransition }
