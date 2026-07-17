import { Icon } from "@/components/ui/icon"
import { RiFolderLine } from "@remixicon/react"

/**
 * Deterministic default project icon tile (captured: 32px square, 8px radius,
 * default border, folder glyph in the foreground color). Custom icon/color
 * persistence is intentionally out of scope, so every project renders the same
 * folder.
 */
export function ProjectIcon() {
  return (
    <div
      className="border-border-default bg-background flex size-8 shrink-0 items-center justify-center rounded-md border"
      data-testid="project-folder-icon"
    >
      <Icon icon={RiFolderLine} slotSize={20} />
    </div>
  )
}
