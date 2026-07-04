"use client"

import { HTMLMotionProps, motion, MotionProps } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"

export type TextScrambleProps = {
  children: string
  duration?: number
  speed?: number
  characterSet?: string
  as?: React.ElementType
  className?: string
  trigger?: boolean
  onScrambleComplete?: () => void
} & MotionProps

const defaultChars =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

export function TextScramble({
  children,
  duration = 0.8,
  speed = 0.04,
  characterSet = defaultChars,
  className,
  as: Component = "p",
  trigger = true,
  onScrambleComplete,
  ...props
}: TextScrambleProps) {
  const MotionComponent = motion.create(
    Component as string
  ) as React.ComponentType<HTMLMotionProps<"p">>
  const [displayText, setDisplayText] = useState(children)
  const isAnimatingRef = useRef(false)
  const text = children

  const scramble = useCallback(() => {
    if (isAnimatingRef.current) return
    isAnimatingRef.current = true

    const steps = duration / speed
    let step = 0

    const interval = setInterval(() => {
      let scrambled = ""
      const progress = step / steps

      for (let i = 0; i < text.length; i++) {
        if (text[i] === " ") {
          scrambled += " "
          continue
        }

        if (progress * text.length > i) {
          scrambled += text[i]
        } else {
          scrambled +=
            characterSet[Math.floor(Math.random() * characterSet.length)]
        }
      }

      setDisplayText(scrambled)
      step++

      if (step > steps) {
        clearInterval(interval)
        setDisplayText(text)
        isAnimatingRef.current = false
        onScrambleComplete?.()
      }
    }, speed * 1000)

    return interval
  }, [duration, speed, text, characterSet, onScrambleComplete])

  useEffect(() => {
    if (!trigger) return

    const interval = scramble()

    return () => {
      if (interval) {
        clearInterval(interval)
        isAnimatingRef.current = false
      }
    }
  }, [trigger, scramble])

  return (
    <MotionComponent className={className} {...props}>
      {displayText}
    </MotionComponent>
  )
}
