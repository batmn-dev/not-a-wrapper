"use client"

import { cn } from "@/lib/utils"
import {
  AnimatePresence,
  motion,
  SpringOptions,
  Transition,
  useMotionValue,
  useSpring,
  Variant,
} from "motion/react"
import React, { useEffect, useRef, useState } from "react"

export type CursorProps = {
  children: React.ReactNode
  className?: string
  springConfig?: SpringOptions
  attachToParent?: boolean
  transition?: Transition
  variants?: {
    initial: Variant
    animate: Variant
    exit: Variant
  }
  onPositionChange?: (x: number, y: number) => void
}

export function Cursor({
  children,
  className,
  springConfig,
  attachToParent,
  variants,
  transition,
  onPositionChange,
}: CursorProps) {
  const cursorX = useMotionValue(0)
  const cursorY = useMotionValue(0)
  const cursorRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(!attachToParent)

  useEffect(() => {
    if (typeof window !== "undefined") {
      cursorX.set(window.innerWidth / 2)
      cursorY.set(window.innerHeight / 2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Initial position should only be set once on mount
  }, [])

  useEffect(() => {
    if (!attachToParent) {
      document.body.style.cursor = "none"
    } else {
      document.body.style.cursor = "auto"
    }

    const updatePosition = (e: MouseEvent) => {
      cursorX.set(e.clientX)
      cursorY.set(e.clientY)
      onPositionChange?.(e.clientX, e.clientY)
    }

    document.addEventListener("mousemove", updatePosition)

    return () => {
      document.removeEventListener("mousemove", updatePosition)
    }
  }, [attachToParent, cursorX, cursorY, onPositionChange])

  const cursorXSpring = useSpring(cursorX, springConfig || { duration: 0 })
  const cursorYSpring = useSpring(cursorY, springConfig || { duration: 0 })

  useEffect(() => {
    const currentRef = cursorRef.current

    if (!attachToParent || !currentRef) return

    const parent = currentRef.parentElement
    if (!parent) return

    const handleMouseEnter = () => {
      parent.style.cursor = "none"
      setIsVisible(true)
    }

    const handleMouseLeave = () => {
      parent.style.cursor = "auto"
      setIsVisible(false)
    }

    parent.addEventListener("mouseenter", handleMouseEnter)
    parent.addEventListener("mouseleave", handleMouseLeave)

    return () => {
      parent.removeEventListener("mouseenter", handleMouseEnter)
      parent.removeEventListener("mouseleave", handleMouseLeave)
    }
  }, [attachToParent])

  return (
    <motion.div
      ref={cursorRef}
      className={cn("pointer-events-none fixed top-0 left-0 z-50", className)}
      style={{
        x: cursorXSpring,
        y: cursorYSpring,
        translateX: "-50%",
        translateY: "-50%",
      }}
    >
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial="initial"
            animate="animate"
            exit="exit"
            variants={variants}
            transition={transition}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
