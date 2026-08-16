import { Icon, type IconProps } from "@/components/ui/icon"

type MenuLeadingIconProps = {
  icon: IconProps["icon"]
}

/**
 * Stable leading slot for floating-menu rows. The slot intentionally preserves
 * the existing 20px slot / 18px glyph geometry while menu rows own the gap.
 */
function MenuLeadingIcon({ icon }: MenuLeadingIconProps) {
  return <Icon icon={icon} slotSize="var(--floating-menu-leading-slot-size)" />
}

export { MenuLeadingIcon }
