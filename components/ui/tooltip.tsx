"use client"

import { cn } from "@/lib/utils"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import * as React from "react"

type TooltipShortcutProps = Omit<React.ComponentProps<"span">, "children"> & {
  label: React.ReactNode
  children: React.ReactNode
  detail?: React.ReactNode
}

type TooltipMultilineProps = React.ComponentProps<"span">

const TooltipContentIdContext = React.createContext<string | undefined>(
  undefined
)

function getNodeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node)
  }

  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return React.Children.toArray(node).map(getNodeText).join("")
  }

  return getNodeText(node.props.children)
}

function getShortcutKeyLabels(children: React.ReactNode): string[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (
      !React.isValidElement<{
        "aria-label"?: string
        children?: React.ReactNode
        label?: string
      }>(child)
    ) {
      const text = getNodeText(child)
      return text ? [text] : []
    }

    if (child.type === React.Fragment) {
      return getShortcutKeyLabels(child.props.children)
    }

    const label =
      child.props.label ??
      child.props["aria-label"] ??
      getNodeText(child.props.children)
    return label ? [label] : []
  })
}

/**
 * Stacks related tooltip lines and opts the surface into multiline rounding.
 * Single-line tooltips keep the pill-shaped default.
 */
function TooltipMultiline({ className, ...props }: TooltipMultilineProps) {
  return (
    <span
      data-slot="tooltip-multiline"
      className={cn(
        "flex flex-col items-center text-center leading-tight",
        className
      )}
      {...props}
    />
  )
}

/**
 * Tooltip label + keyboard shortcut composition.
 * The action is announced as one phrase while its visible keys sit in the
 * same compact capsule as the reference tooltip.
 */
function TooltipShortcut({
  label,
  children,
  detail,
  className,
  "aria-label": ariaLabel,
  ...props
}: TooltipShortcutProps) {
  const actionAriaLabel =
    ariaLabel ??
    [getNodeText(label), ...getShortcutKeyLabels(children)]
      .filter(Boolean)
      .join(", ")

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
        className="inline-flex items-center whitespace-nowrap"
      >
        <span className="sr-only">{actionAriaLabel}</span>
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <span>{label}</span>
          <span
            data-slot="tooltip-shortcut-keys"
            className="-me-1.5 inline-flex h-[18px] items-center rounded-full bg-white/25 px-1.5 text-sm leading-[18px] font-semibold whitespace-pre text-[var(--text-secondary)] [text-box:trim-both_text] pointer-coarse:hidden [&_kbd]:h-[18px] [&_kbd]:min-w-0 [&_kbd]:[align-items:normal] [&_kbd]:justify-normal [&_kbd]:[font-family:inherit] [&_kbd]:text-sm [&_kbd]:leading-[18px] [&_kbd>span]:min-w-[1em]"
          >
            {children}
          </span>
        </span>
      </span>
      <span
        data-slot="tooltip-shortcut-detail"
        className="font-medium text-[var(--text-tertiary)] empty:hidden"
      >
        {detail}
      </span>
    </span>
  )
}

function TooltipProvider(
  props: Omit<TooltipPrimitive.Provider.Props, "delay">
) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      {...props}
      delay={0}
    />
  )
}

function Tooltip({
  disableHoverablePopup = true,
  ...props
}: TooltipPrimitive.Root.Props) {
  const contentId = `base-ui-${React.useId()}`
  return (
    <TooltipContentIdContext.Provider value={contentId}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        disableHoverablePopup={disableHoverablePopup}
        {...props}
      />
    </TooltipContentIdContext.Provider>
  )
}

function TooltipTrigger({
  "aria-describedby": ariaDescribedBy,
  ...props
}: TooltipPrimitive.Trigger.Props) {
  const contentId = React.useContext(TooltipContentIdContext)

  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      aria-describedby={ariaDescribedBy ?? contentId}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  align = "center",
  alignOffset = 0,
  children,
  hideArrow = true,
  variant = "default",
  role = "tooltip",
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    hideArrow?: boolean
    variant?: "default" | "outline"
  }) {
  const contentId = React.useContext(TooltipContentIdContext)

  return (
    <TooltipPrimitive.Portal keepMounted>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          id={contentId}
          role={role}
          data-slot="tooltip-content"
          data-variant={variant}
          className={cn(
            "z-50 w-max max-w-[min(var(--container-xs),calc(100dvw-2*var(--spacing)))] overflow-hidden rounded-(--tooltip-radius) px-3 py-[5px] [font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,'Segoe_UI',Helvetica,'Apple_Color_Emoji',Arial,sans-serif,'Segoe_UI_Emoji','Segoe_UI_Symbol'] transition-opacity duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] select-none has-[[data-slot=tooltip-multiline]]:rounded-(--tooltip-multiline-radius) pointer-coarse:sr-only",
            variant === "default"
              ? "dark shadow-tooltip border border-[var(--border-tooltip)] bg-[var(--bg-tooltip)] text-white"
              : "bg-popover text-popover-foreground shadow-floating-surface",
            className
          )}
          {...props}
        >
          <div
            data-slot="tooltip-content-text"
            className={cn(
              "text-center text-sm leading-[18px] tracking-[-0.15px] whitespace-pre-wrap",
              variant === "default" ? "font-semibold" : "font-medium"
            )}
          >
            {children}
          </div>
          {!hideArrow && (
            <TooltipPrimitive.Arrow
              className={cn(
                "z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5",
                variant === "default"
                  ? "bg-[var(--bg-tooltip)] fill-[var(--bg-tooltip)]"
                  : "bg-popover fill-popover"
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
  TooltipMultiline,
  TooltipProvider,
  TooltipShortcut,
}
