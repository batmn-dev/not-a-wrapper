import { cn } from "@/lib/utils"
import type React from "react"

type InlineRenameInputProps = Omit<
  React.ComponentProps<"input">,
  "aria-label" | "name" | "type"
> & {
  "aria-label": string
}

/**
 * Shared title-editing field. Typography belongs to the host surface, so the
 * input inherits its font and color instead of defining a separate edit-state
 * treatment. Focusing the field selects the current title for quick replacement.
 */
export function InlineRenameInput({
  className,
  onFocus,
  ...props
}: InlineRenameInputProps) {
  const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    event.currentTarget.select()
    onFocus?.(event)
  }

  return (
    <input
      type="text"
      name="title-editor"
      {...props}
      className={cn(
        "min-w-0 grow border-none bg-transparent p-0 text-inherit outline-none [font:inherit] focus:ring-0 focus-visible:ring-0",
        className
      )}
      onFocus={handleFocus}
    />
  )
}
