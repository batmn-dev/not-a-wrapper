import { cn } from "@/lib/utils"
import * as React from "react"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "shadow-border placeholder:text-muted-foreground focus-visible:ring-ring/50 aria-invalid:shadow-border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40 flex field-sizing-content min-h-20 w-full rounded-md bg-transparent px-2.5 py-2 transition-[color,box-shadow] outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3",
        className,
        "text-base"
      )}
      {...props}
    />
  )
}

export { Textarea }
