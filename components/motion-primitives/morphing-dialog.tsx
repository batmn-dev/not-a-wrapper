"use client"

import { Icon } from "@/components/ui/icon"
import useClickOutside from "@/hooks/useClickOutside"
import { cn } from "@/lib/utils"
import { RiCloseLargeLine } from "@remixicon/react"
import {
  AnimatePresence,
  motion,
  MotionConfig,
  Transition,
  Variant,
} from "motion/react"
import React, {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { createPortal } from "react-dom"

// Hydration-safe hook using useSyncExternalStore (React 19 pattern)
const subscribe = () => () => {}
const getSnapshot = () => true
const getServerSnapshot = () => false

function useHydrated() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export type MorphingDialogContextType = {
  isOpen: boolean
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>
  uniqueId: string
  triggerRef: React.RefObject<HTMLDivElement>
}

const MorphingDialogContext =
  React.createContext<MorphingDialogContextType | null>(null)

function useMorphingDialog() {
  const context = useContext(MorphingDialogContext)
  if (!context) {
    throw new Error(
      "useMorphingDialog must be used within a MorphingDialogProvider"
    )
  }
  return context
}

export type MorphingDialogProviderProps = {
  children: React.ReactNode
  transition?: Transition
}

function MorphingDialogProvider({
  children,
  transition,
}: MorphingDialogProviderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const uniqueId = useId()
  const triggerRef = useRef<HTMLDivElement>(null!)

  const contextValue = useMemo(
    () => ({
      isOpen,
      setIsOpen,
      uniqueId,
      triggerRef,
    }),
    [isOpen, uniqueId]
  )

  return (
    <MorphingDialogContext.Provider value={contextValue}>
      <MotionConfig transition={transition}>{children}</MotionConfig>
    </MorphingDialogContext.Provider>
  )
}

export type MorphingDialogProps = {
  children: React.ReactNode
  transition?: Transition
}

function MorphingDialog({ children, transition }: MorphingDialogProps) {
  return (
    <MorphingDialogProvider>
      <MotionConfig transition={transition}>{children}</MotionConfig>
    </MorphingDialogProvider>
  )
}

export type MorphingDialogTriggerProps = {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  triggerRef?: React.RefObject<HTMLButtonElement>
}

function MorphingDialogTrigger({
  children,
  className,
  style,
  triggerRef,
}: MorphingDialogTriggerProps) {
  const { setIsOpen, isOpen, uniqueId } = useMorphingDialog()

  const handleClick = useCallback(() => {
    setIsOpen(!isOpen)
  }, [isOpen, setIsOpen])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        setIsOpen(!isOpen)
      }
    },
    [isOpen, setIsOpen]
  )

  return (
    <motion.button
      ref={triggerRef}
      layoutId={`dialog-${uniqueId}`}
      className={cn("relative", className)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={style}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={`motion-ui-morphing-dialog-content-${uniqueId}`}
      aria-label={`Open dialog ${uniqueId}`}
    >
      {children}
    </motion.button>
  )
}

export type MorphingDialogContentProps = {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

function MorphingDialogContent({
  children,
  className,
  style,
}: MorphingDialogContentProps) {
  const { setIsOpen, isOpen, uniqueId, triggerRef } = useMorphingDialog()
  const containerRef = useRef<HTMLDivElement>(null!)
  // Use refs instead of state for focus trap elements (not needed for rendering)
  const firstFocusableRef = useRef<HTMLElement | null>(null)
  const lastFocusableRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
      if (event.key === "Tab") {
        const firstEl = firstFocusableRef.current
        const lastEl = lastFocusableRef.current
        if (!firstEl || !lastEl) return

        if (event.shiftKey) {
          if (document.activeElement === firstEl) {
            event.preventDefault()
            lastEl.focus()
          }
        } else {
          if (document.activeElement === lastEl) {
            event.preventDefault()
            firstEl.focus()
          }
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [setIsOpen])

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add("overflow-hidden")
      const focusableElements = containerRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElements && focusableElements.length > 0) {
        firstFocusableRef.current = focusableElements[0] as HTMLElement
        lastFocusableRef.current = focusableElements[
          focusableElements.length - 1
        ] as HTMLElement
        ;(focusableElements[0] as HTMLElement).focus()
      }
    } else {
      document.body.classList.remove("overflow-hidden")
      triggerRef.current?.focus()
    }
  }, [isOpen, triggerRef])

  useClickOutside(containerRef, () => {
    if (isOpen) {
      setIsOpen(false)
    }
  })

  return (
    <motion.div
      ref={containerRef}
      layoutId={`dialog-${uniqueId}`}
      className={cn("overflow-hidden", className)}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`motion-ui-morphing-dialog-title-${uniqueId}`}
      aria-describedby={`motion-ui-morphing-dialog-description-${uniqueId}`}
    >
      {children}
    </motion.div>
  )
}

export type MorphingDialogContainerProps = {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

function MorphingDialogContainer({ children }: MorphingDialogContainerProps) {
  const { isOpen, uniqueId } = useMorphingDialog()
  const mounted = useHydrated()

  if (!mounted) return null

  return createPortal(
    <AnimatePresence initial={false} mode="sync">
      {isOpen && (
        <>
          <motion.div
            key={`backdrop-${uniqueId}`}
            className="fixed inset-0 h-full w-full bg-white/40 backdrop-blur-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            {children}
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}

export type MorphingDialogTitleProps = {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

function MorphingDialogTitle({
  children,
  className,
  style,
}: MorphingDialogTitleProps) {
  const { uniqueId } = useMorphingDialog()

  return (
    <motion.div
      layoutId={`dialog-title-container-${uniqueId}`}
      className={className}
      style={style}
      layout
    >
      {children}
    </motion.div>
  )
}

export type MorphingDialogSubtitleProps = {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

function MorphingDialogSubtitle({
  children,
  className,
  style,
}: MorphingDialogSubtitleProps) {
  const { uniqueId } = useMorphingDialog()

  return (
    <motion.div
      layoutId={`dialog-subtitle-container-${uniqueId}`}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  )
}

export type MorphingDialogDescriptionProps = {
  children: React.ReactNode
  className?: string
  disableLayoutAnimation?: boolean
  variants?: {
    initial: Variant
    animate: Variant
    exit: Variant
  }
}

function MorphingDialogDescription({
  children,
  className,
  variants,
  disableLayoutAnimation,
}: MorphingDialogDescriptionProps) {
  const { uniqueId } = useMorphingDialog()

  return (
    <motion.div
      key={`dialog-description-${uniqueId}`}
      layoutId={
        disableLayoutAnimation
          ? undefined
          : `dialog-description-content-${uniqueId}`
      }
      variants={variants}
      className={className}
      initial="initial"
      animate="animate"
      exit="exit"
      id={`dialog-description-${uniqueId}`}
    >
      {children}
    </motion.div>
  )
}

export type MorphingDialogImageProps = {
  src: string
  alt: string
  className?: string
  style?: React.CSSProperties
}

function MorphingDialogImage({
  src,
  alt,
  className,
  style,
}: MorphingDialogImageProps) {
  const { uniqueId } = useMorphingDialog()

  return (
    <motion.img
      src={src}
      alt={alt}
      className={cn(className)}
      layoutId={`dialog-img-${uniqueId}`}
      style={style}
    />
  )
}

export type MorphingDialogCloseProps = {
  children?: React.ReactNode
  className?: string
  variants?: {
    initial: Variant
    animate: Variant
    exit: Variant
  }
}

function MorphingDialogClose({
  children,
  className,
  variants,
}: MorphingDialogCloseProps) {
  const { setIsOpen, uniqueId } = useMorphingDialog()

  const handleClose = useCallback(() => {
    setIsOpen(false)
  }, [setIsOpen])

  return (
    <motion.button
      onClick={handleClose}
      type="button"
      aria-label="Close dialog"
      key={`dialog-close-${uniqueId}`}
      className={cn("fixed top-6 right-6", className)}
      initial="initial"
      animate="animate"
      exit="exit"
      variants={variants}
    >
      {children || <Icon icon={RiCloseLargeLine} slotSize={24} />}
    </motion.button>
  )
}

export {
  MorphingDialog,
  MorphingDialogTrigger,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogClose,
  MorphingDialogTitle,
  MorphingDialogSubtitle,
  MorphingDialogDescription,
  MorphingDialogImage,
}
