"use client"

import { cn } from "@/lib/utils"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

type TooltipShortcutProps = Omit<React.ComponentProps<"span">, "children"> & {
  label: React.ReactNode
  children: React.ReactNode
  detail?: React.ReactNode
}

/**
 * ChatGPT-style tooltip label + keyboard shortcut composition.
 * Shortcut keys stay unboxed, inherit the tooltip's tertiary token, and use
 * cap-height trimming so modifier glyphs align with the label text.
 */
function TooltipShortcut({
  label,
  children,
  detail,
  className,
  ...props
}: TooltipShortcutProps) {
  return (
    <span
      data-slot="tooltip-shortcut"
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap",
        className
      )}
      {...props}
    >
      <span
        data-slot="tooltip-shortcut-action"
        className="inline-flex items-center gap-2 whitespace-nowrap"
      >
        <span>{label}</span>
        <span
          data-slot="tooltip-shortcut-keys"
          className="inline-flex whitespace-pre [text-box:trim-both_text] text-[var(--text-tertiary)] font-medium pointer-coarse:hidden [&_kbd]:min-w-0 [&_kbd]:[align-items:normal] [&_kbd]:justify-normal [&_kbd]:text-xs [&_kbd]:[font-family:inherit] [&_kbd>span]:min-w-[1em]"
        >
          {children}
        </span>
      </span>
      <span
        data-slot="tooltip-shortcut-detail"
        className="text-[var(--text-tertiary)] font-medium"
      >
        {detail}
      </span>
    </span>
  )
}

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function Tooltip({
  delay,
  disableHoverablePopup = true,
  ...props
}: TooltipPrimitive.Root.Props & {
  delay?: number
}) {
  const root = (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      disableHoverablePopup={disableHoverablePopup}
      {...props}
    />
  )

  if (delay !== undefined) {
    return <TooltipProvider delay={delay}>{root}</TooltipProvider>
  }

  return root
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  hideArrow = true,
  variant = "default",
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    hideArrow?: boolean
    variant?: "default" | "outline"
  }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs items-center gap-2 rounded-[8px] px-2 py-1 [font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,'Segoe_UI',Helvetica,'Apple_Color_Emoji',Arial,sans-serif,'Segoe_UI_Emoji','Segoe_UI_Symbol'] text-xs leading-4 font-semibold transition-opacity",
            variant === "default"
              ? "dark border border-[var(--border-tooltip)] bg-[var(--bg-tooltip)] text-[var(--text-primary)] shadow-none"
              : "bg-popover text-popover-foreground shadow-border-md",
            className
          )}
          {...props}
        >
          {children}
          {!hideArrow && (
            <TooltipPrimitive.Arrow
              className={cn(
                "z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5",
                variant === "default"
                  ? "bg-[var(--bg-tooltip)] fill-[var(--bg-tooltip)]"
                  : "fill-popover bg-popover"
              )}
            />
          )}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  TooltipShortcut,
}
