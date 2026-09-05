/** Keep first-send motion off the critical path: update before animating live DOM. */
function runComposerSlideTransition(update: () => void) {
  const selector = 'form[data-type="unified-composer"]'
  const before = document.querySelector<HTMLElement>(selector)
  const animate =
    document.visibilityState === "visible" &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches &&
    typeof before?.animate === "function"
  const start = animate ? before.getBoundingClientRect() : undefined

  update()

  const after = document.querySelector<HTMLElement>(selector)
  if (!start || !after?.animate) return
  const end = after.getBoundingClientRect()
  const deltaY = start.top - end.top
  if (!deltaY) return
  const easing = getComputedStyle(after)
    .getPropertyValue("--spring-fast")
    .trim()
  after.animate(
    [{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }],
    { duration: 500, easing: easing || "ease-out" }
  )
}

export { runComposerSlideTransition }
