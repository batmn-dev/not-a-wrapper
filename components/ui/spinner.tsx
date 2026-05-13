import { cn } from "@/lib/utils"
import { RiLoader2Line } from "@remixicon/react"
import * as React from "react"

function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof RiLoader2Line>) {
  return (
    <RiLoader2Line
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
