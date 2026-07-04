import { cn } from "@/lib/utils"
import { Input as InputPrimitive } from "@base-ui/react/input"
import * as React from "react"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "shadow-border file:text-foreground placeholder:text-muted-foreground focus-visible:ring-ring/50 aria-invalid:shadow-border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40 h-10 w-full min-w-0 rounded-md bg-transparent px-2.5 py-1 transition-[color,box-shadow] outline-none file:inline-flex file:h-8 file:cursor-pointer file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 disabled:file:cursor-not-allowed aria-invalid:ring-3",
        className,
        "text-base"
      )}
      {...props}
    />
  )
}

export { Input }
