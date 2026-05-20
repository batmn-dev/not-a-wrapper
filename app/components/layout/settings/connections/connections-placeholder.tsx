import { Icon } from "@/components/ui/icon"
import { RiPlugLine } from "@remixicon/react"

export function ConnectionsPlaceholder() {
  return (
    <div className="py-8 text-center">
      <Icon
        icon={RiPlugLine}
        slotSize={48}
        className="text-muted-foreground mx-auto mb-2"
      />
      <h3 className="mb-1 text-sm font-medium">No developer tools available</h3>
      <p className="text-muted-foreground text-sm">
        Third-party service connections will appear here in development mode.
      </p>
    </div>
  )
}
