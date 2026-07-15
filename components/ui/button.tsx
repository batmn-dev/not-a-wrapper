"use client"

import { cn } from "@/lib/utils"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-clip-padding text-sm font-medium whitespace-nowrap outline-hidden transition-transform select-none [--icon-slot-size:1rem] focus-visible:ring-3 focus-visible:ring-focus-ring active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-bg-hover",
        outline:
          "bg-input-bg shadow-border hover:bg-input-bg-hover hover:text-foreground hover:shadow-border-hover aria-expanded:bg-input-bg-hover aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary-bg-hover aria-expanded:bg-secondary-bg-hover aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-interactive-hover hover:text-foreground active:bg-interactive-pressed",
        destructive:
          "bg-destructive/10 text-destructive shadow-border-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-link underline-offset-4 hover:text-link-hover hover:underline",
      },
      size: {
        default:
          "h-9 gap-1 px-3 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-0.5 rounded-[min(var(--radius-md),8px)] px-1.5 text-xs [--icon-slot-size:0.75rem] in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-0.5 rounded-[min(var(--radius-md),10px)] px-2 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-10 gap-1 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        icon: "size-9",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),8px)] [--icon-slot-size:0.75rem] in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      render={render}
      {...(render && { nativeButton: false })}
      {...props}
    />
  )
}

export { Button, buttonVariants }
