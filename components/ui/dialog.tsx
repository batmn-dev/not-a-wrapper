import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { RiCloseLargeLine } from "@remixicon/react"
import * as React from "react"

type DialogSurface = "default" | "centered"

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
  surface = "default",
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  surface?: DialogSurface
}) {
  return (
    <DialogPortal>
      <DialogOverlay surface={surface} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-surface={surface}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 p-6 text-sm outline-none sm:max-w-md",
          surface === "centered"
            ? "bg-modal-centered text-modal-centered-foreground shadow-modal-centered rounded-(--modal-centered-radius)"
            : "bg-popover text-popover-foreground shadow-border-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 rounded-xl duration-100",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4"
                size="icon-sm"
              />
            }
          >
            <Icon icon={RiCloseLargeLine} />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
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
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
