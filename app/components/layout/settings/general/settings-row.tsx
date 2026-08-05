import { cn } from "@/lib/utils"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import type { ComponentProps, MouseEvent, ReactNode } from "react"

export function SettingsFieldGroup({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="settings-field-group"
      className={cn(
        "outline-border-default/80 bg-foreground/1 w-full overflow-hidden rounded-[calc(var(--radius)+var(--radius))] outline-1",
        className
      )}
      {...props}
    />
  )
}

export function SettingsField({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "border-border group/settings-field flex min-h-16 w-full border-b p-0.5 first:[&>[data-slot=settings-field-surface]]:rounded-t-2xl last:border-b-0 last:[&>[data-slot=settings-field-surface]]:rounded-b-2xl",
          className
        ),
      },
      props
    ),
    render,
    state: { slot: "settings-field" },
  })
}

export function SettingsFieldSurface({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "group/settings-field-surface relative flex w-full flex-1 flex-col items-stretch justify-center gap-2 rounded-md px-3.5 py-3 text-left outline-none sm:flex-row sm:items-center sm:gap-8 sm:py-0",
          "data-[interactive]:cursor-pointer data-[interactive]:hover:bg-row-hover data-[interactive]:active:bg-interactive-pressed data-[interactive]:focus-visible:ring-2 data-[interactive]:focus-visible:ring-focus-ring data-[interactive]:focus-visible:ring-inset",
          "data-[disabled]:pointer-events-none data-[disabled]:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
          className
        ),
      },
      props
    ),
    render,
    state: { slot: "settings-field-surface" },
  })
}

export function SettingsFieldLeading({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="settings-field-leading"
      className={cn("flex shrink-0 items-center justify-center", className)}
      {...props}
    />
  )
}

export function SettingsFieldContent({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="settings-field-content"
      className={cn("flex min-w-0 flex-1 flex-col gap-1", className)}
      {...props}
    />
  )
}

export function SettingsFieldLabel({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="settings-field-label"
      className={cn(
        "text-foreground text-sm leading-6 font-medium text-balance",
        className
      )}
      {...props}
    />
  )
}

export function SettingsFieldDescription({
  className,
  ...props
}: ComponentProps<"p">) {
  return (
    <p
      data-slot="settings-field-description"
      className={cn(
        "text-muted-foreground text-sm leading-5 text-pretty",
        className
      )}
      {...props}
    />
  )
}

const interactiveControlSelector =
  "a,button,input,select,textarea,[role=button],[role=checkbox],[role=combobox],[role=radio],[role=switch]"

export function SettingsFieldControl({
  className,
  onClick,
  ...props
}: ComponentProps<"div">) {
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element) {
      const interactiveControl = event.target.closest(
        interactiveControlSelector
      )
      if (
        interactiveControl &&
        event.currentTarget.contains(interactiveControl)
      ) {
        event.stopPropagation()
      }
    }
    onClick?.(event)
  }

  return (
    <div
      data-slot="settings-field-control"
      className={cn(
        "flex w-full min-w-0 shrink-0 items-center justify-start gap-1 sm:w-auto sm:justify-end",
        className
      )}
      onClick={handleClick}
      {...props}
    />
  )
}

export function SettingsFieldValue({
  className,
  children,
  ...props
}: ComponentProps<"span"> & { children: ReactNode }) {
  return (
    <span
      data-slot="settings-field-value"
      className={cn(
        "text-foreground min-w-0 truncate text-sm leading-6 sm:text-right",
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
