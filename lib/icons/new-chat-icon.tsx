import { Icon } from "@/components/ui/icon"
import { RiAddLine } from "@remixicon/react"

/**
 * Custom New Chat icon with 5% opacity circle background.
 * Combines RiAddLine (plus) with a subtle filled circle behind it.
 * The circle extends 2px beyond the icon on all sides.
 */
export function NewChatIcon({
  size = 18,
  className,
}: {
  size?: number
  className?: string
}) {
  const circleSize = size + 4 // 2px larger on each side
  const circleOffset = -2 // Center the larger circle
  const iconSize = size - 4 // Plus icon slightly smaller
  const iconOffset = 2 // Center the smaller icon

  return (
    <div
      className={`relative ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      {/* Circle background at 5% opacity - extends 2px beyond icon */}
      <svg
        width={circleSize}
        height={circleSize}
        viewBox="0 0 24 24"
        fill="none"
        className="absolute"
        style={{ top: circleOffset, left: circleOffset }}
      >
        <circle cx="12" cy="12" r="12" fill="currentColor" opacity="0.1" />
      </svg>
      {/* RiAddLine (plus sign) on top - slightly smaller and centered */}
      <Icon
        icon={RiAddLine}
        slotSize={iconSize}
        className="absolute"
        style={{ top: iconOffset, left: iconOffset }}
      />
    </div>
  )
}
