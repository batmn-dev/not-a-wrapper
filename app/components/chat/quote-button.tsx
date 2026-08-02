import { Button } from "@/components/ui/button"
import useClickOutside from "@/hooks/useClickOutside"
import { RefObject, useLayoutEffect, useRef, useState } from "react"

type QuoteButtonProps = {
  mousePosition: { x: number; y: number }
  onQuote: () => void
  messageContainerRef: RefObject<HTMLElement | null>
  onDismiss: () => void
}

export function QuoteButton({
  mousePosition,
  onQuote,
  messageContainerRef,
  onDismiss,
}: QuoteButtonProps) {
  const buttonRef = useRef<HTMLDivElement>(null)
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null)
  useClickOutside(buttonRef as RefObject<HTMLElement>, onDismiss)

  // Measure container rect once on mount - it doesn't depend on mouse position
  useLayoutEffect(() => {
    if (messageContainerRef.current) {
      setContainerRect(messageContainerRef.current.getBoundingClientRect())
    }
  }, [messageContainerRef])

  const buttonHeight = 60
  const position = containerRect
    ? {
        top: mousePosition.y - containerRect.top - buttonHeight,
        left: mousePosition.x - containerRect.left,
      }
    : { top: 0, left: 0 }

  return (
    <div
      ref={buttonRef}
      className="absolute z-50"
      style={{
        top: position.top,
        left: position.left,
        transform: "translateX(-50%)",
      }}
    >
      <Button
        type="button"
        onClick={onQuote}
        className="bg-popover text-popover-foreground hover:bg-popover-bg-hover shadow-border-md h-9 rounded-[12px] px-3 text-sm"
      >
        Add to chat
      </Button>
    </div>
  )
}
