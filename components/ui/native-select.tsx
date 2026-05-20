import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiArrowDownSLine } from "@remixicon/react"
import * as React from "react"

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
}

function NativeSelect({
  className,
  size = "default",
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn(
        "group/native-select relative w-fit has-[select:disabled]:opacity-50",
        className
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="shadow-border selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:ring-ring/50 aria-invalid:shadow-border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 h-10 w-full min-w-0 cursor-pointer appearance-none rounded-md bg-transparent py-1 pr-8 pl-2.5 text-base transition-[color,box-shadow] outline-none select-none focus-visible:ring-3 disabled:cursor-not-allowed aria-invalid:ring-3 data-[size=sm]:h-9"
        {...props}
      />
      <Icon
        icon={RiArrowDownSLine}
        slotSize={16}
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 select-none"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
