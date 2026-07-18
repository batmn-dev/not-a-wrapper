import { Icon, type IconProps } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

type SidebarLeadingIconProps = {
  icon: IconProps["icon"]
  activeIcon?: IconProps["icon"]
  isActive?: boolean
  labelSpacing?: boolean
}

/**
 * The sidebar's single leading-glyph geometry contract. Row primitives own
 * placement through this slot so callers cannot introduce baseline alignment,
 * per-state margins, or icon-specific sizing.
 */
export function SidebarLeadingIcon({
  icon,
  activeIcon,
  isActive,
  labelSpacing = true,
}: SidebarLeadingIconProps) {
  const resolvedIcon = isActive && activeIcon ? activeIcon : icon

  return (
    <span
      data-slot="sidebar-leading-icon"
      data-label-spacing={labelSpacing ? "true" : undefined}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center",
        labelSpacing && "me-1.5"
      )}
    >
      <Icon icon={resolvedIcon} slotSize={20} />
    </span>
  )
}
