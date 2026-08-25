import { cn } from "@/lib/utils"
import * as React from "react"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "bg-input-bg shadow-border placeholder:text-placeholder focus-visible:ring-focus-ring aria-invalid:shadow-border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 flex field-sizing-content min-h-20 w-full rounded-md px-2.5 py-2 transition-[color,box-shadow] outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3",
        className,
        "text-base"
      )}
      {...props}
    />
  )
}

export { Textarea }
