import { cn } from "@/lib/utils"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [--icon-slot-size:0.75rem] [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-focus-ring focus-visible:ring-focus-ring focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "text-foreground [a&]:hover:bg-interactive-hover [a&]:hover:text-foreground",
        source:
          "group/source-badge gap-1.5 rounded-md border-0 bg-transparent px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-interactive-hover",
        // Soft-tint status family (token-driven): a light fill + colored text +
        // faint border, in one visual language. failed/denied share `danger`.
        info: "border-info/20 bg-info/10 text-info",
        warning: "border-warning/30 bg-warning/10 text-warning-foreground",
        success:
          "border-status-success-foreground/25 bg-status-success-bg text-status-success-foreground",
        danger: "border-destructive/20 bg-destructive/10 text-destructive",
        neutral: "border-border bg-muted text-muted-foreground",
      },
      size: {
        default: "",
        sm: "h-5",
        md: "h-[25px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Badge({
  className,
  variant,
  size,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  const defaultProps: useRender.ElementProps<"span"> = {
    className: cn(badgeVariants({ variant, size }), className),
  }

  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">(defaultProps, props),
    state: { slot: "badge", variant, size },
  })
}

export { Badge, badgeVariants }
