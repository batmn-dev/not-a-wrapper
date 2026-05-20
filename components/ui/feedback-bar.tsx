import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiCloseLine, RiThumbDownLine, RiThumbUpLine } from "@remixicon/react"

type FeedbackBarProps = {
  className?: string
  title?: string
  icon?: React.ReactNode
  onHelpful?: () => void
  onNotHelpful?: () => void
  onClose?: () => void
}

export function FeedbackBar({
  className,
  title,
  icon,
  onHelpful,
  onNotHelpful,
  onClose,
}: FeedbackBarProps) {
  return (
    <div
      className={cn(
        "bg-background border-border inline-flex rounded-[12px] border text-sm",
        className
      )}
    >
      <div className="flex w-full items-center justify-between">
        <div className="flex flex-1 items-center justify-start gap-4 py-3 pl-4">
          {icon}
          <span className="text-foreground font-medium">{title}</span>
        </div>
        <div className="flex items-center justify-center gap-0.5 px-3 py-0">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-md transition-colors"
            aria-label="Helpful"
            onClick={onHelpful}
          >
            <Icon icon={RiThumbUpLine} slotSize={16} />
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-md transition-colors"
            aria-label="Not helpful"
            onClick={onNotHelpful}
          >
            <Icon icon={RiThumbDownLine} slotSize={16} />
          </button>
        </div>
        <div className="border-border flex items-center justify-center border-l">
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground flex items-center justify-center rounded-md p-3"
            aria-label="Close"
          >
            <Icon icon={RiCloseLine} slotSize={20} />
          </button>
        </div>
      </div>
    </div>
  )
}
