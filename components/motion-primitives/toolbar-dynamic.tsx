"use client"

import { Icon } from "@/components/ui/icon"
import useClickOutside from "@/hooks/useClickOutside"
import { RiArrowLeftLine, RiSearchLine, RiUserLine } from "@remixicon/react"
import { motion, MotionConfig } from "motion/react"
import React, { useRef, useState } from "react"

const transition = {
  type: "spring" as const,
  bounce: 0.1,
  duration: 0.2,
}

function Button({
  children,
  onClick,
  disabled,
  ariaLabel,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <button
      className="relative flex h-9 w-9 shrink-0 scale-100 appearance-none items-center justify-center rounded-lg text-zinc-500 transition-colors select-none hover:bg-zinc-100 hover:text-zinc-800 focus-visible:ring-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  )
}

export default function ToolbarDynamic() {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useClickOutside(containerRef, () => {
    setIsOpen(false)
  })

  return (
    <MotionConfig transition={transition}>
      <div className="absolute bottom-8" ref={containerRef}>
        <div className="h-full w-full rounded-xl border border-zinc-950/10 bg-white">
          <motion.div
            animate={{
              // @todo: here I want to remove the width
              width: isOpen ? "300px" : "98px",
            }}
            initial={false}
          >
            <div className="overflow-hidden p-2">
              {!isOpen ? (
                <div className="flex space-x-2">
                  <Button disabled ariaLabel="User profile">
                    <Icon icon={RiUserLine} slotSize={20} />
                  </Button>
                  <Button
                    onClick={() => setIsOpen(true)}
                    ariaLabel="Search notes"
                  >
                    <Icon icon={RiSearchLine} slotSize={20} />
                  </Button>
                </div>
              ) : (
                <div className="flex space-x-2">
                  <Button onClick={() => setIsOpen(false)} ariaLabel="Back">
                    <Icon icon={RiArrowLeftLine} slotSize={20} />
                  </Button>
                  <div className="relative w-full">
                    <input
                      className="h-9 w-full rounded-lg border border-zinc-950/10 bg-transparent p-2 text-zinc-900 placeholder-zinc-500 focus:outline-hidden"
                      autoFocus
                      placeholder="Search notes"
                    />
                    <div className="absolute top-0 right-1 flex h-full items-center justify-center"></div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </MotionConfig>
  )
}
