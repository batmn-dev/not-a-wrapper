"use client"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { RiCloseLine } from "@remixicon/react"
import * as React from "react"

type DialogSurface = "default" | "centered"
type DialogSize = "normal" | "large" | "xlarge" | "fullscreen"

// A titled DialogHeader claims the close control so DialogContent's default
// close button is suppressed instead of rendering a second "Close".
type DialogContentContextValue = {
  claimCloseButton: () => () => void
}

const DialogContentContext =
  React.createContext<DialogContentContextValue | null>(null)

const dialogSizeClassNames: Record<DialogSize, string> = {
  normal: "sm:max-w-md",
  large: "sm:max-w-lg",
  xlarge: "sm:max-w-xl",
  fullscreen: "h-[100cqh] w-[100cqw] max-w-none",
}

function Dialog({
  ...props
}: Omit<DialogPrimitive.Root.Props, "children"> & {
  children?: React.ReactNode
}) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ className, ...props }: DialogPrimitive.Trigger.Props) {
  return (
    <DialogPrimitive.Trigger
      data-slot="dialog-trigger"
      className={cn(
        "cursor-pointer disabled:cursor-not-allowed aria-disabled:cursor-not-allowed data-disabled:cursor-not-allowed",
        className
      )}
      {...props}
    />
  )
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

type DialogCloseButtonProps = Omit<DialogPrimitive.Close.Props, "children"> & {
  background?: "transparent" | "primary"
  iconSize?: "md" | "lg"
}

// Never auto-focuses by default so Base UI's initial focus (first tabbable) and
// explicit targets win; pass `autoFocus` only where Close is the intended target.
function DialogCloseButton({
  background = "transparent",
  className,
  iconSize = "md",
  ...props
}: DialogCloseButtonProps) {
  return (
    <DialogPrimitive.Close
      type="button"
      data-slot="dialog-close-button"
      data-testid="close-button"
      aria-label="Close"
      className={cn(
        "hover:bg-interactive-hover focus-visible:bg-interactive-hover focus-visible:outline-foreground flex size-9 grow-0 items-center justify-center rounded-[8px] focus-visible:outline-[1.5px] focus-visible:outline-offset-[2.5px] focus-visible:[outline-style:solid]",
        background === "transparent" ? "bg-transparent" : "bg-modal-centered",
        className
      )}
      {...props}
    >
      <Icon
        icon={RiCloseLine}
        slotSize={iconSize === "lg" ? 24 : 20}
        glyphInset={0}
      />
    </DialogPrimitive.Close>
  )
}

function DialogOverlay({
  className,
  surface = "default",
  ...props
}: DialogPrimitive.Backdrop.Props & {
  surface?: DialogSurface
}) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      data-surface={surface}
      className={cn(
        "fixed inset-0 isolate z-50",
        surface === "centered"
          ? "bg-[var(--modal-centered-scrim)] [backdrop-filter:blur(var(--modal-centered-backdrop-blur))] transition-[opacity,backdrop-filter] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)] data-[ending-style]:opacity-0 data-[ending-style]:[backdrop-filter:blur(0)] data-[starting-style]:opacity-0 data-[starting-style]:[backdrop-filter:blur(0)]"
          : "bg-scrim-modal data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 duration-100 supports-backdrop-filter:backdrop-blur-[1px]",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = "normal",
  surface = "default",
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  size?: DialogSize
  surface?: DialogSurface
}) {
  const [closeButtonClaims, setCloseButtonClaims] = React.useState(0)
  const contextValue = React.useMemo<DialogContentContextValue>(
    () => ({
      claimCloseButton: () => {
        setCloseButtonClaims((count) => count + 1)
        return () => setCloseButtonClaims((count) => count - 1)
      },
    }),
    []
  )

  return (
    <DialogContentContext.Provider value={contextValue}>
      <DialogPortal>
        <DialogOverlay surface={surface} />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          data-size={size}
          data-surface={surface}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 p-6 text-sm outline-none",
            dialogSizeClassNames[size],
            surface === "centered"
              ? "bg-modal-centered text-modal-centered-foreground shadow-modal-centered rounded-(--modal-centered-radius)"
              : "bg-popover text-popover-foreground shadow-border-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 rounded-xl duration-100",
            className
          )}
          {...props}
        >
          {children}
          {showCloseButton && closeButtonClaims === 0 ? (
            <DialogCloseButton className="absolute top-4 right-4" />
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </DialogContentContext.Provider>
  )
}

type DialogHeaderProps = Omit<React.ComponentProps<"div">, "title"> & {
  description?: React.ReactNode
  disableAutoFocusTitle?: boolean
  disableCloseButtonAutoFocus?: boolean
  hideCloseButton?: boolean
  icon?: React.ReactNode
  title?: React.ReactNode
}

function DialogHeader({
  children,
  className,
  description,
  disableAutoFocusTitle = false,
  disableCloseButtonAutoFocus = false,
  hideCloseButton = false,
  icon,
  title,
  ...props
}: DialogHeaderProps) {
  const titleRef = React.useRef<HTMLHeadingElement>(null)
  const content = React.useContext(DialogContentContext)
  const ownsCloseButton = title !== undefined

  React.useLayoutEffect(() => {
    if (!disableAutoFocusTitle) titleRef.current?.focus()
  }, [disableAutoFocusTitle])

  // Claimed even with hideCloseButton: a titled header is the sole close owner.
  React.useLayoutEffect(() => {
    if (ownsCloseButton) return content?.claimCloseButton()
  }, [content, ownsCloseButton])

  if (title === undefined) {
    return (
      <div
        data-slot="dialog-header"
        className={cn("flex flex-col gap-2", className)}
        {...props}
      >
        {children}
      </div>
    )
  }

  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "min-h-header-height flex flex-wrap items-start gap-2 p-2 ps-4",
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "flex max-w-[calc(100%-100px)] min-w-0 gap-2",
          !description && "self-center"
        )}
      >
        {icon ? (
          <div className="flex h-7 w-5 shrink-0 items-center justify-center">
            {icon}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-col">
          <DialogTitle
            className="font-[inherit] text-lg leading-7 font-normal"
            ref={titleRef}
            tabIndex={-1}
          >
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription
              className="ms-0.5 mb-0.5 text-xs text-[var(--text-tertiary)]"
              render={<div />}
            >
              {description}
            </DialogDescription>
          ) : null}
        </div>
      </div>
      <div className="grow" />
      {children ? <span>{children}</span> : null}
      {hideCloseButton ? null : (
        <DialogCloseButton
          autoFocus={disableAutoFocusTitle && !disableCloseButtonAutoFocus}
        />
      )}
    </div>
  )
}

// Slots mode and children mode are exclusive: slots own the footer layout, so
// `children` / `showCloseButton` are rejected there instead of silently dropped.
type DialogFooterProps = Omit<React.ComponentProps<"div">, "children"> &
  (
    | {
        footerContent?: React.ReactNode
        primaryButton?: React.ReactNode
        secondaryButton?: React.ReactNode
        children?: never
        showCloseButton?: never
      }
    | {
        footerContent?: never
        primaryButton?: never
        secondaryButton?: never
        children?: React.ReactNode
        showCloseButton?: boolean
      }
  )

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  footerContent,
  primaryButton,
  secondaryButton,
  ...props
}: DialogFooterProps) {
  const usesSlots =
    footerContent !== undefined ||
    primaryButton !== undefined ||
    secondaryButton !== undefined

  if (usesSlots) {
    const hasActions = primaryButton != null || secondaryButton != null

    if (!hasActions && footerContent == null) return null

    return (
      <div
        data-slot="dialog-footer"
        className={cn(
          "flex w-full items-center p-3 ps-4 text-sm select-none",
          className
        )}
        {...props}
      >
        {footerContent}
        <div className="grow" />
        {hasActions ? (
          <div className="flex shrink-0 gap-1.5">
            {secondaryButton}
            {primaryButton}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton ? (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      ) : null}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading leading-none font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-muted-foreground *:[a]:hover:text-foreground text-sm *:[a]:underline *:[a]:underline-offset-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
