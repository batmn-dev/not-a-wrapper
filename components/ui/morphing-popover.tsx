"use client"

import useClickOutside from "@/hooks/useClickOutside"
import { cn } from "@/lib/utils"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import {
  AnimatePresence,
  motion,
  MotionConfig,
  Transition,
  Variants,
} from "motion/react"
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"

const TRANSITION = {
  type: "spring",
  bounce: 0.1,
  duration: 0.4,
} as const

type MorphingPopoverContextValue = {
  isOpen: boolean
  open: () => void
  close: () => void
  uniqueId: string
  variants?: Variants
}

const MorphingPopoverContext =
  createContext<MorphingPopoverContextValue | null>(null)

function usePopoverLogic({
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
}: {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
} = {}) {
  const uniqueId = useId()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)

  const isOpen = controlledOpen ?? uncontrolledOpen

  const open = () => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(true)
    }
    onOpenChange?.(true)
  }

  const close = () => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(false)
    }
    onOpenChange?.(false)
  }

  return { isOpen, open, close, uniqueId }
}

export type MorphingPopoverProps = {
  children: React.ReactNode
  transition?: Transition
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  variants?: Variants
  className?: string
} & React.ComponentProps<"div">

function MorphingPopover({
  children,
  transition = TRANSITION,
  defaultOpen,
  open,
  onOpenChange,
  variants,
  className,
  ...props
}: MorphingPopoverProps) {
  const popoverLogic = usePopoverLogic({ defaultOpen, open, onOpenChange })

  return (
    <MorphingPopoverContext.Provider value={{ ...popoverLogic, variants }}>
      <MotionConfig transition={transition}>
        <div
          className={cn("relative flex items-center justify-center", className)}
          key={popoverLogic.uniqueId}
          {...props}
        >
          {children}
        </div>
      </MotionConfig>
    </MorphingPopoverContext.Provider>
  )
}

export type MorphingPopoverTriggerProps = {
  className?: string
} & useRender.ComponentProps<"button">

function MorphingPopoverTrigger({
  className,
  render,
  ...props
}: MorphingPopoverTriggerProps) {
  const context = useContext(MorphingPopoverContext)
  if (!context) {
    throw new Error(
      "MorphingPopoverTrigger must be used within MorphingPopover"
    )
  }

  const defaultProps: useRender.ElementProps<"button"> = {
    type: "button",
    className,
    onClick: context.open,
    "aria-expanded": context.isOpen,
    "aria-controls": `popover-content-${context.uniqueId}`,
  }

  const trigger = useRender({
    defaultTagName: "button",
    render: render ?? (
      <motion.button
        layoutId={`popover-label-${context.uniqueId}`}
        key={context.uniqueId}
      />
    ),
    props: mergeProps<"button">(defaultProps, props),
  })

  return (
    <motion.div
      key={context.uniqueId}
      layoutId={`popover-trigger-${context.uniqueId}`}
    >
      {trigger}
    </motion.div>
  )
}

export type MorphingPopoverContentProps = {
  children: React.ReactNode
  className?: string
} & React.ComponentProps<typeof motion.div>

function MorphingPopoverContent({
  children,
  className,
  ...props
}: MorphingPopoverContentProps) {
  const context = useContext(MorphingPopoverContext)
  if (!context)
    throw new Error(
      "MorphingPopoverContent must be used within MorphingPopover"
    )

  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, context.close)

  useEffect(() => {
    if (!context.isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") context.close()
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only need to track isOpen and close function, not entire context object
  }, [context.isOpen, context.close])

  return (
    <AnimatePresence>
      {context.isOpen && (
        <>
          <motion.div
            {...props}
            ref={ref}
            layoutId={`popover-trigger-${context.uniqueId}`}
            key={context.uniqueId}
            id={`popover-content-${context.uniqueId}`}
            role="dialog"
            aria-modal="true"
            className={cn(
              "absolute overflow-hidden rounded-md border border-zinc-950/10 bg-white p-2 text-zinc-950 shadow-md dark:border-zinc-50/10 dark:bg-zinc-700 dark:text-zinc-50",
              className
            )}
            initial="initial"
            animate="animate"
            exit="exit"
            variants={context.variants}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export { MorphingPopover, MorphingPopoverTrigger, MorphingPopoverContent }
