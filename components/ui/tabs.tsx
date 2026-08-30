import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      orientation={orientation}
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
        /* Transparent list whose active trigger carries a muted pill; the
           registry code panels' Usage/Source switcher. */
        ghost: "bg-transparent p-0",
        /** Transparent pill row with a bordered selected trigger. */
        pill: "gap-1 bg-transparent p-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "text-foreground/60 hover:text-foreground focus-visible:ring-focus-ring focus-visible:outline-focus-ring dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-border-xs relative inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium whitespace-nowrap transition-shadow group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start focus-visible:ring-[3px] focus-visible:outline-1 disabled:cursor-not-allowed disabled:opacity-50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "group-data-[variant=ghost]/tabs-list:data-active:bg-muted dark:group-data-[variant=ghost]/tabs-list:data-active:bg-input-bg group-data-[variant=ghost]/tabs-list:h-full group-data-[variant=ghost]/tabs-list:rounded-lg group-data-[variant=ghost]/tabs-list:px-3 group-data-[variant=ghost]/tabs-list:font-normal",
        "data-active:bg-background data-active:text-foreground dark:data-active:bg-input-bg dark:data-active:text-foreground",
        "group-data-[variant=pill]/tabs-list:hover:bg-interactive-hover group-data-[variant=pill]/tabs-list:data-active:bg-interactive-selected group-data-[variant=pill]/tabs-list:data-active:ring-border-strong dark:group-data-[variant=pill]/tabs-list:data-active:bg-interactive-selected group-data-[variant=pill]/tabs-list:h-[38px] group-data-[variant=pill]/tabs-list:flex-none group-data-[variant=pill]/tabs-list:rounded-full group-data-[variant=pill]/tabs-list:px-4 group-data-[variant=pill]/tabs-list:py-[9px] group-data-[variant=pill]/tabs-list:text-sm/5 group-data-[variant=pill]/tabs-list:font-medium group-data-[variant=pill]/tabs-list:text-[var(--text-tertiary)] group-data-[variant=pill]/tabs-list:hover:text-[var(--text-primary)] group-data-[variant=pill]/tabs-list:data-active:text-[var(--text-primary)] group-data-[variant=pill]/tabs-list:data-active:ring-1",
        "after:bg-foreground after:absolute after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
