/**
 * Responsive thread variables use explicit 40rem/53.5rem/64rem container
 * thresholds; Tailwind's named container scale resolves to different
 * widths. Keep these declaration fragments last at call sites so their class
 * order remains stable. LayoutApp makes `#main` the nearest named container,
 * so opening the source-shaped side pane narrows these tiers with the thread.
 */
export const THREAD_GUTTER_VARS =
  "[--thread-content-margin:1rem] @[40rem]/main:[--thread-content-margin:1.5rem] @[64rem]/main:[--thread-content-margin:4rem]"

export const THREAD_MAXWIDTH_VARS =
  "[--thread-content-max-width:40rem] @[53.5rem]/main:[--thread-content-max-width:48rem] @[64rem]/main:[--thread-content-max-width:48rem]"

/**
 * Applied to every turn so programmatic scrolling reserves response space and
 * respects the scroll root's safe-area variables.
 */
export const TURN_SCROLL_MARGIN_BOTTOM =
  "threadScrollVars scroll-mb-[calc(var(--scroll-root-safe-area-inset-bottom,0px)+var(--thread-response-height))]"
