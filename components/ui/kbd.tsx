import { cn } from "@/lib/utils"

type KbdProps = {
  children: React.ReactNode
  /** Accessible label for special keys like ⌘, ⇧ */
  label?: string
  className?: string
}

/**
 * Keyboard key indicator component.
 * Use for displaying keyboard shortcuts in UI.
 *
 * @example
 * <Kbd label="Command">⌘</Kbd>
 * <Kbd>K</Kbd>
 */
export function Kbd({ children, label, className }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      aria-label={label}
      className={cn(
        "inline-flex min-w-[1em] items-center justify-center font-sans text-sm",
        className
      )}
    >
      <span>{children}</span>
    </kbd>
  )
}

type KbdGroupProps = {
  children: React.ReactNode
  className?: string
}

/**
 * Container for grouping multiple Kbd components.
 * Automatically handles spacing and layout.
 *
 * @example
 * <KbdGroup>
 *   <Kbd label="Command">⌘</Kbd>
 *   <Kbd>K</Kbd>
 * </KbdGroup>
 */
export function KbdGroup({ children, className }: KbdGroupProps) {
  return (
    <div
      data-slot="kbd-group"
      className={cn(
        "text-muted-foreground inline-flex whitespace-pre pointer-coarse:hidden",
        className
      )}
    >
      {children}
    </div>
  )
}
