"use client"

import { cn } from "@/lib/utils"
import {
  HTMLMotionProps,
  motion,
  SpringOptions,
  useSpring,
  useTransform,
} from "motion/react"
import { useEffect } from "react"

export type AnimatedNumberProps = {
  value: number
  className?: string
  springOptions?: SpringOptions
  as?: React.ElementType
}

export function AnimatedNumber({
  value,
  className,
  springOptions,
  as = "span",
}: AnimatedNumberProps) {
  const MotionComponent = motion.create(as as string) as React.ComponentType<
    HTMLMotionProps<"span">
  >

  const spring = useSpring(value, springOptions)
  const display = useTransform(spring, (current) =>
    Math.round(current).toLocaleString()
  )

  useEffect(() => {
    spring.set(value)
  }, [spring, value])

  return (
    <MotionComponent className={cn("tabular-nums", className)}>
      {display}
    </MotionComponent>
  )
}
