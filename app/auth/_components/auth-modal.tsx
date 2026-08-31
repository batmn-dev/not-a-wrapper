"use client"

import { initialAuthActionState } from "@/app/auth/_lib/schemas"
import { requestMagicAuthCode } from "@/app/auth/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { RiCloseLargeLine } from "@remixicon/react"
import {
  useActionState,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import {
  AuthProviderDivider,
  AuthProviderOptions,
  AuthProviderStatus,
  type AuthProviderName,
} from "./auth-provider-options"

const DEFAULT_AUTH_TITLE = "Log in or sign up"
const DEFAULT_AUTH_DESCRIPTION =
  "You'll get smarter responses and can upload files, images, and more."

type AuthModalContentProps = {
  title?: ReactNode
  description?: ReactNode
}

type AuthModalProps = AuthModalContentProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type AuthModalTriggerProps = {
  children: ReactNode
  className?: string
  size?: ComponentProps<typeof Button>["size"]
  variant?: ComponentProps<typeof Button>["variant"]
}

export function AuthModal({
  open,
  onOpenChange,
  title,
  description,
}: AuthModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AuthModalContent title={title} description={description} />
    </Dialog>
  )
}

export function AuthModalTrigger({
  children,
  className,
  size,
  variant,
}: AuthModalTriggerProps) {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button className={className} size={size} variant={variant} />}
      >
        {children}
      </DialogTrigger>
      <AuthModalContent />
    </Dialog>
  )
}

function AuthModalContent({
  title = DEFAULT_AUTH_TITLE,
  description = DEFAULT_AUTH_DESCRIPTION,
}: AuthModalContentProps) {
  const [state, formAction, isPending] = useActionState(
    requestMagicAuthCode,
    initialAuthActionState
  )
  const [providerMessage, setProviderMessage] = useState<string | null>(null)

  const handleProviderClick = (provider: AuthProviderName) => {
    setProviderMessage(
      `${provider} sign-in is not available yet. Continue with email to get a code.`
    )
  }

  return (
    <DialogContent
      showCloseButton={false}
      surface="centered"
      className="z-[100] max-h-[calc(100svh-20px)] w-[calc(100vw-20px)] max-w-[373px] gap-0 overflow-hidden p-0 sm:max-w-[388px]"
    >
      <header className="flex min-h-12 items-start justify-end p-2.5 pb-0">
        <DialogClose
          render={
            <Button
              aria-label="Close"
              className="size-9 rounded-full"
              size="icon-sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <Icon icon={RiCloseLargeLine} slotSize={20} />
          <span className="sr-only">Close</span>
        </DialogClose>
      </header>

      <div className="overflow-y-auto">
        <div className="flex flex-col items-stretch gap-5 px-6 pb-10">
          <div className="space-y-5 text-center">
            <DialogTitle className="text-[30px] leading-9 font-normal tracking-normal">
              {title}
            </DialogTitle>
            {description ? (
              <DialogDescription className="text-foreground mx-auto max-w-[290px] text-base leading-6">
                {description}
              </DialogDescription>
            ) : null}
          </div>

          <form action={formAction} className="flex flex-col gap-4" noValidate>
            <AuthProviderOptions
              buttonClassName="h-[58px]"
              onUnavailable={handleProviderClick}
            />
            <AuthProviderStatus message={providerMessage} />
            <AuthProviderDivider className="my-2" />

            <div>
              <Input
                aria-invalid={!!state.fieldErrors?.email}
                aria-label="Email address"
                autoComplete="email"
                className={cn(
                  "border-border focus-visible:border-foreground focus-visible:ring-foreground h-[58px] rounded-full border px-5 text-base shadow-none focus-visible:ring-1",
                  state.fieldErrors?.email &&
                    "border-destructive focus-visible:border-destructive focus-visible:ring-destructive"
                )}
                name="email"
                placeholder="Email address"
                required
                type="email"
              />
              {state.fieldErrors?.email ? (
                <p role="alert" className="text-destructive mt-2 px-5 text-sm">
                  {state.fieldErrors.email}
                </p>
              ) : null}
            </div>

            {state.message ? (
              <p role="alert" className="text-destructive text-center text-sm">
                {state.message}
              </p>
            ) : null}

            <Button
              className="mt-1.5 h-[58px] w-full rounded-full bg-[#0d0d0d] text-base text-white shadow-none hover:bg-[#2f2f2f] dark:bg-white dark:text-black dark:hover:bg-white/90"
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Sending..." : "Continue"}
            </Button>
          </form>
        </div>
      </div>
    </DialogContent>
  )
}
