import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ComposerControlProps = Omit<ButtonProps, "variant">

/**
 * The shared secondary action inside the Composer.
 *
 * This module owns the complete interaction contract: token colors,
 * input-modality states, open-state styling, tap target, and the
 * Button primitive's scale animation. Callers own only their local geometry.
 */
function ComposerControl({ className, ...props }: ComposerControlProps) {
  return (
    <Button
      data-composer-control=""
      className={cn("composer-btn relative z-0", className)}
      variant="composer"
      {...props}
    />
  )
}

export { ComposerControl, type ComposerControlProps }
