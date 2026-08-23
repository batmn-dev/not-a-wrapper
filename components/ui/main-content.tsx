import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"

function MainContent({
  className,
  tabIndex = -1,
  ...props
}: ComponentProps<"main">) {
  return (
    <main
      data-slot="main-content"
      tabIndex={tabIndex}
      className={cn("not-keyboard-focused:outline-none", className)}
      {...props}
    />
  )
}

export { MainContent }
