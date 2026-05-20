import { Icon, type IconProps } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiLoader2Line } from "@remixicon/react"
import * as React from "react"

function Spinner({
  className,
  slotSize = 16,
  ...props
}: Omit<IconProps, "icon">) {
  return (
    <Icon
      icon={RiLoader2Line}
      slotSize={slotSize}
      className={cn("animate-spin", className)}
      role="status"
      aria-label="Loading"
      {...props}
    />
  )
}

export { Spinner }
