import { ComposerControl } from "@/components/ui/composer-control"
import type { ComponentProps } from "react"

type ComposerIconButtonProps = Omit<
  ComponentProps<typeof ComposerControl>,
  "size"
>

/** Shared 36px icon control used inside the unified composer surface. */
function ComposerIconButton({ className, ...props }: ComposerIconButtonProps) {
  return <ComposerControl className={className} size="icon" {...props} />
}

export { ComposerIconButton, type ComposerIconButtonProps }
