"use client"

import { cn } from "@/lib/utils"
import { PreviewCard as HoverCardPrimitive } from "@base-ui/react/preview-card"

function HoverCard({ ...props }: HoverCardPrimitive.Root.Props) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({
  className,
  ...props
}: HoverCardPrimitive.Trigger.Props) {
  return (
    <HoverCardPrimitive.Trigger
      data-slot="hover-card-trigger"
      className={cn(
        "cursor-pointer disabled:cursor-not-allowed aria-disabled:cursor-not-allowed data-disabled:cursor-not-allowed",
        className
      )}
      {...props}
    />
  )
}

function HoverCardContent({
  className,
  align = "center",
  side = "bottom",
  sideOffset = 4,
  ...props
}: HoverCardPrimitive.Popup.Props &
  Pick<HoverCardPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        className="isolate z-50"
      >
        <HoverCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            "bg-popover text-popover-foreground shadow-border-md z-50 w-64 origin-(--transform-origin) rounded-md p-4 outline-hidden data-[ending-style]:[transform:scale(0.95)] data-[ending-style]:opacity-0 data-[starting-style]:[transform:scale(0.95)] data-[starting-style]:opacity-0",
            className
          )}
          style={{
            transition: "opacity 150ms ease-out, transform 150ms ease-out",
          }}
          {...props}
        />
      </HoverCardPrimitive.Positioner>
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
