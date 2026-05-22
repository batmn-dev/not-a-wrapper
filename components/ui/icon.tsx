import { cn } from "@/lib/utils"
import type { RemixiconComponentType } from "@remixicon/react"
import type { CSSProperties, HTMLAttributes } from "react"
import { forwardRef } from "react"

type IconLength = number | string

type IconStyle = CSSProperties & {
  "--icon-slot-size"?: string
  "--icon-glyph-inset"?: string
  "--icon-glyph-size"?: string
}

type IconSpanProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  "data-slot"?: string
}

type IconProps = IconSpanProps & {
  icon: RemixiconComponentType
  size?: IconLength
  slotSize?: IconLength
  glyphSize?: IconLength
  glyphInset?: IconLength
  iconClassName?: string
  decorative?: boolean
}

function toCssLength(value: IconLength) {
  return typeof value === "number" ? `${value}px` : value
}

const Icon = forwardRef<HTMLSpanElement, IconProps>(function Icon(
  {
    icon: IconComponent,
    size,
    slotSize,
    glyphSize,
    glyphInset,
    iconClassName,
    className,
    decorative = true,
    "aria-label": ariaLabel,
    "aria-hidden": ariaHidden,
    "data-slot": dataSlot,
    role,
    style,
    ...props
  },
  ref
) {
  const isDecorative =
    decorative && ariaLabel === undefined && role === undefined
  const resolvedSlotSize = slotSize ?? size
  const resolvedStyle: IconStyle = {
    "--icon-glyph-size":
      glyphSize !== undefined
        ? toCssLength(glyphSize)
        : "calc(var(--icon-slot-size) - var(--icon-glyph-inset))",
    ...(resolvedSlotSize !== undefined
      ? {
          "--icon-slot-size": toCssLength(resolvedSlotSize),
        }
      : {}),
    ...(glyphInset !== undefined && {
      "--icon-glyph-inset": toCssLength(glyphInset),
    }),
    ...style,
  }

  return (
    <span
      ref={ref}
      data-slot={dataSlot ?? "icon"}
      aria-label={ariaLabel}
      aria-hidden={isDecorative ? true : ariaHidden}
      role={isDecorative ? undefined : (role ?? "img")}
      className={cn(
        "pointer-events-none inline-flex size-[var(--icon-slot-size)] shrink-0 items-center justify-center",
        className
      )}
      style={resolvedStyle}
      {...props}
    >
      <IconComponent
        aria-hidden="true"
        focusable="false"
        className={cn("size-[var(--icon-glyph-size)] shrink-0", iconClassName)}
      />
    </span>
  )
})

export { Icon, type IconProps }
