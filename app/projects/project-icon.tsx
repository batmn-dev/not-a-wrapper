import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiFolderLine } from "@remixicon/react"

/**
 * Deterministic default project icon tile (captured: 32px square, 8px radius,
 * default border, folder glyph in the foreground color). Custom icon/color
 * persistence is intentionally out of scope, so every project renders the same
 * folder.
 */
export function ProjectIcon({ empty = false }: { empty?: boolean }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center border",
        empty
          ? "border-border-light bg-[var(--projects-control-fill)] mx-auto mb-4 size-14 rounded-[1rem]"
          : "border-border-default bg-[var(--projects-control-surface)] size-8 rounded-md"
      )}
      data-testid="project-folder-icon"
    >
      <Icon
        icon={RiFolderLine}
        slotSize={empty ? 32 : 20}
        glyphInset={0}
        className={empty ? "max-md:size-7" : undefined}
      />
    </div>
  )
}
