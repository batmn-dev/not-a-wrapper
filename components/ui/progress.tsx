import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "@base-ui/react/progress"

function Progress({
  className,
  value,
  ...props
}: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root data-slot="progress" value={value} {...props}>
      <ProgressPrimitive.Track
        className={cn(
          "bg-primary/20 data-[indeterminate]:bg-muted relative h-2 w-full overflow-hidden rounded-full",
          className
        )}
      >
        {/* Base UI sets the indicator width itself (min/max-aware); a manual
            transform would re-hardcode the 0–100 assumption. */}
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="bg-primary h-full transition-all data-[indeterminate]:hidden"
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

export { Progress }
