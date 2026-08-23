import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"

type ComposerIconButtonProps = Omit<
  ComponentProps<typeof Button>,
  "size" | "variant"
>

/** Shared 36px icon control used inside the unified composer surface. */
function ComposerIconButton({
  className,
  ...props
}: ComposerIconButtonProps) {
  return (
    <Button
      className={cn("composer-btn relative z-0 active:scale-100", className)}
      size="icon"
      variant="ghost"
      {...props}
    />
  )
}

export { ComposerIconButton, type ComposerIconButtonProps }
