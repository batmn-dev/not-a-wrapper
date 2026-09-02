import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

const buttonVariants = cva(
  "group/button pointer-events-auto inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-clip-padding text-sm font-medium whitespace-nowrap outline-hidden select-none [--icon-slot-size:1rem] keyboard-focused:[outline-color:var(--interactive-outline-color,var(--text-primary))] keyboard-focused:outline-[1.5px] keyboard-focused:outline-offset-[2.5px] keyboard-focused:[outline-style:solid] disabled:cursor-not-allowed disabled:opacity-50 data-[visually-disabled]:cursor-not-allowed data-[visually-disabled]:opacity-50 [&:active:not(:disabled)]:opacity-80 aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border border-transparent bg-primary text-primary-foreground hover:bg-primary-bg-hover",
        outline:
          "bg-input-bg shadow-border hover:bg-input-bg-hover hover:text-foreground hover:shadow-border-hover aria-expanded:bg-input-bg-hover aria-expanded:text-foreground",
        secondary:
          "border-border-default bg-(--composer-surface-primary) border text-secondary-foreground hover:bg-secondary-bg-hover aria-expanded:bg-secondary-bg-hover aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-interactive-hover hover:text-foreground active:bg-interactive-pressed",
        composer: "text-foreground",
        destructive:
          "bg-destructive/10 text-destructive shadow-border-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-link underline-offset-4 hover:text-link-hover hover:underline",
      },
      disabledVariant: {
        default: "",
        muted:
          "disabled:bg-primary/50 disabled:hover:bg-primary/50 data-[visually-disabled]:bg-primary/50 data-[visually-disabled]:hover:bg-primary/50",
      },
      size: {
        default:
          "min-h-9 gap-1 px-3 pointer-coarse:min-h-10 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
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
      pressMotion: {
        scale: "press-motion",
        none: "",
      },
    },
    defaultVariants: {
      variant: "default",
      disabledVariant: "default",
      size: "default",
      pressMotion: "scale",
    },
  }
)

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Keeps the label visible, appends progress, and prevents activation. */
    loading?: boolean
    /**
     * Presents an unavailable action without removing it from sequential focus.
     * Base UI cancels activation before a submit or click can occur.
     */
    visuallyDisabled?: boolean
  }

function Button({
  className,
  variant = "default",
  disabledVariant = "default",
  size = "default",
  pressMotion = "scale",
  loading = false,
  visuallyDisabled = false,
  disabled = false,
  focusableWhenDisabled = false,
  children,
  "aria-busy": ariaBusy,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={loading ? "" : undefined}
      data-visually-disabled={visuallyDisabled ? "" : undefined}
      aria-busy={loading ? true : ariaBusy}
      disabled={disabled || visuallyDisabled || loading}
      focusableWhenDisabled={visuallyDisabled || focusableWhenDisabled}
      className={cn(
        buttonVariants({
          variant,
          disabledVariant,
          size,
          pressMotion,
          className,
        })
      )}
      {...props}
    >
      {children}
      {loading ? (
        <Spinner
          aria-hidden="true"
          aria-label={undefined}
          className="ms-0.5"
          slotSize={16}
        />
      ) : null}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants, type ButtonProps }
