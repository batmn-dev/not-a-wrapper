"use client"

import { cn } from "@/lib/utils"
import { AnimatePresence, motion, Transition } from "motion/react"
import {
  Children,
  cloneElement,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react"

export type AnimatedBackgroundProps = {
  children:
    ReactElement<{ "data-id": string }>[] | ReactElement<{ "data-id": string }>
  defaultValue?: string
  onValueChange?: (newActiveId: string | null) => void
  className?: string
  transition?: Transition
  enableHover?: boolean
}

export function AnimatedBackground({
  children,
  defaultValue,
  onValueChange,
  className,
  transition,
  enableHover = false,
}: AnimatedBackgroundProps) {
  const [activeId, setActiveId] = useState<string | null>(defaultValue ?? null)
  const [prevDefaultValue, setPrevDefaultValue] = useState(defaultValue)
  const uniqueId = useId()

  // React 19 pattern: sync during render instead of useEffect
  if (defaultValue !== prevDefaultValue) {
    setPrevDefaultValue(defaultValue)
    if (defaultValue !== undefined) {
      setActiveId(defaultValue)
    }
  }

  const handleSetActiveId = (id: string | null) => {
    setActiveId(id)

    if (onValueChange) {
      onValueChange(id)
    }
  }

  return Children.map(children, (child, index) => {
    // Cast to access strongly typed props
    const childElement = child as ReactElement<{
      "data-id": string
      className?: string
      children?: React.ReactNode
    }>
    const id = childElement.props["data-id"]

    const interactionProps = enableHover
      ? {
          onMouseEnter: () => handleSetActiveId(id),
          onMouseLeave: () => handleSetActiveId(null),
        }
      : {
          onClick: () => handleSetActiveId(id),
        }

    // Use type assertion for cloneElement to allow additional props
    return cloneElement(
      childElement as ReactElement<Record<string, unknown>>,
      {
        key: index,
        className: cn("relative inline-flex", childElement.props.className),
        "data-checked": activeId === id ? "true" : "false",
        ...interactionProps,
      },
      <>
        <AnimatePresence initial={false}>
          {activeId === id && (
            <motion.div
              layoutId={`background-${uniqueId}`}
              className={cn("absolute inset-0", className)}
              transition={transition}
              initial={{ opacity: defaultValue ? 1 : 0 }}
              animate={{
                opacity: 1,
              }}
              exit={{
                opacity: 0,
              }}
            />
          )}
        </AnimatePresence>
        <div className="z-10">{childElement.props.children}</div>
      </>
    )
  })
}
