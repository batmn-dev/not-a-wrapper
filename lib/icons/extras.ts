/**
 * Re-exports for commonly used Remix icons that have local aliases.
 */

import { Icon, type IconProps } from "@/components/ui/icon"
import {
  RiDraggable,
  RiExpandLeftLine,
  RiPushpinFill,
  RiPushpinLine,
  RiStopFill,
  RiUnpinFill,
  RiUnpinLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import { createElement, forwardRef } from "react"

type RemixIconAliasProps = Omit<IconProps, "icon" | "slotSize"> & {
  size?: IconProps["slotSize"]
  slotSize?: IconProps["slotSize"]
}

function createRemixIconAlias(
  icon: RemixiconComponentType,
  displayName: string
) {
  const Alias = forwardRef<HTMLSpanElement, RemixIconAliasProps>(
    function RemixIconAlias({ size, slotSize, ...props }, ref) {
      return createElement(Icon, {
        ...props,
        ref,
        icon,
        slotSize: slotSize ?? size,
      })
    }
  )

  Alias.displayName = displayName

  return Alias
}

const GripVertical = createRemixIconAlias(RiDraggable, "GripVertical")
const GripVerticalIcon = GripVertical
const Pin = createRemixIconAlias(RiPushpinLine, "Pin")
const PinIcon = Pin
const PinFilled = createRemixIconAlias(RiPushpinFill, "PinFilled")
const PanelLeft = createRemixIconAlias(RiExpandLeftLine, "PanelLeft")
const PanelLeftIcon = PanelLeft
const StopBulkRoundedIcon = createRemixIconAlias(
  RiStopFill,
  "StopBulkRoundedIcon"
)
const PinOff = createRemixIconAlias(RiUnpinFill, "PinOff")
const PinOffIcon = PinOff
const PinOffOutline = createRemixIconAlias(RiUnpinLine, "PinOffOutline")

export {
  GripVertical,
  GripVerticalIcon,
  Pin,
  PinFilled,
  PinIcon,
  PanelLeft,
  PanelLeftIcon,
  StopBulkRoundedIcon,
  PinOff,
  PinOffIcon,
  PinOffOutline,
}
