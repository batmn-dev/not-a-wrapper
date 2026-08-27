"use client"

import { useReducedMotion } from "motion/react"
import { useRef, type PointerEventHandler } from "react"

const pressKeyframes: Keyframe[] = [
  { transform: "scale(1)" },
  { transform: "scale(0.96)" },
]
const pressTiming: KeyframeAnimationOptions = {
  duration: 75,
  easing: "cubic-bezier(0.4, 0, 0.2, 1)",
  fill: "forwards",
}

/**
 * Keeps a composer's popover anchor still while its visual trigger scales.
 * Apply the handler to a child press surface and anchor the popup to anchorRef.
 */
function useComposerPopoverPress() {
  const shouldReduceMotion = useReducedMotion()
  const anchorRef = useRef<HTMLDivElement>(null)
  const pressAnimationRef = useRef<Animation | null>(null)
  const pressEndCleanupRef = useRef<(() => void) | null>(null)

  const handlePressPointerDown: PointerEventHandler<HTMLDivElement> = (
    event
  ) => {
    if (event.button !== 0 || !event.isPrimary) return

    pressEndCleanupRef.current?.()
    pressAnimationRef.current?.cancel()
    pressAnimationRef.current = null

    if (shouldReduceMotion) return

    // Start before Base UI's mousedown open so menu work cannot delay the press.
    const pressSurface = event.currentTarget
    const animation = pressSurface.animate(pressKeyframes, pressTiming)
    pressAnimationRef.current = animation

    let isReleased = false
    let hasReachedPressedScale = false
    let isReturning = false

    const startReturnAnimation = () => {
      if (isReturning || pressAnimationRef.current !== animation) return
      isReturning = true

      const returnAnimation = pressSurface.animate(
        [...pressKeyframes].reverse(),
        pressTiming
      )
      animation.cancel()
      pressAnimationRef.current = returnAnimation
      returnAnimation.onfinish = () => {
        if (pressAnimationRef.current !== returnAnimation) return
        returnAnimation.cancel()
        pressAnimationRef.current = null
      }
    }

    animation.onfinish = () => {
      if (pressAnimationRef.current !== animation) return
      hasReachedPressedScale = true
      if (isReleased) startReturnAnimation()
    }

    const ownerWindow = pressSurface.ownerDocument.defaultView
    if (!ownerWindow) return

    const pointerId = event.pointerId

    function cleanupPointerEnd() {
      ownerWindow?.removeEventListener("pointerup", handlePointerEnd, true)
      ownerWindow?.removeEventListener("pointercancel", handlePointerEnd, true)
      if (pressEndCleanupRef.current === cleanupPointerEnd) {
        pressEndCleanupRef.current = null
      }
    }

    function handlePointerEnd(endEvent: PointerEvent) {
      if (endEvent.pointerId !== pointerId) return
      cleanupPointerEnd()
      isReleased = true
      if (hasReachedPressedScale) startReturnAnimation()
    }

    pressEndCleanupRef.current = cleanupPointerEnd
    ownerWindow.addEventListener("pointerup", handlePointerEnd, true)
    ownerWindow.addEventListener("pointercancel", handlePointerEnd, true)
  }

  return { anchorRef, handlePressPointerDown }
}

export { useComposerPopoverPress }
