/**
 * Re-exports for commonly used Remix icons that have local aliases.
 */

import { Icon, type IconProps } from "@/components/ui/icon"
import {
  RiDraggable,
  RiExpandLeftLine,
  RiPushpinLine,
  RiStopFill,
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
const PanelLeft = createRemixIconAlias(RiExpandLeftLine, "PanelLeft")
const PanelLeftIcon = PanelLeft
const StopBulkRoundedIcon = createRemixIconAlias(
  RiStopFill,
  "StopBulkRoundedIcon"
)
const PinOff = createRemixIconAlias(RiUnpinLine, "PinOff")
const PinOffIcon = PinOff

export {
  GripVertical,
  GripVerticalIcon,
  Pin,
  PinIcon,
  PanelLeft,
  PanelLeftIcon,
  StopBulkRoundedIcon,
  PinOff,
  PinOffIcon,
}
