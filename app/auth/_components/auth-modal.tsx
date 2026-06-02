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
import { RiAppleFill, RiCloseLine, RiPhoneLine } from "@remixicon/react"
import {
  useActionState,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"

const PROVIDER_GOOGLE_MARK_SIZE = 18
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

  const handleProviderClick = (provider: string) => {
    setProviderMessage(
      `${provider} sign-in is not available yet. Continue with email to get a code.`
    )
  }

  return (
    <DialogContent
      showCloseButton={false}
      className="bg-background text-foreground z-[100] max-h-[calc(100svh-20px)] w-[calc(100vw-20px)] max-w-[373px] gap-0 overflow-hidden rounded-2xl p-0 shadow-[0_18px_60px_rgba(0,0,0,0.18)] sm:max-w-[388px] dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)]"
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
          <Icon icon={RiCloseLine} slotSize={20} />
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
            <div className="flex flex-col gap-3">
              <ProviderButton
                icon={<GoogleMark size={PROVIDER_GOOGLE_MARK_SIZE} />}
                label="Continue with Google"
                onClick={() => handleProviderClick("Google")}
              />
              <ProviderButton
                icon={<Icon icon={RiAppleFill} slotSize={20} />}
                label="Continue with Apple"
                onClick={() => handleProviderClick("Apple")}
              />
              <ProviderButton
                icon={<Icon icon={RiPhoneLine} slotSize={20} glyphSize={24} />}
                label="Continue with phone"
                onClick={() => handleProviderClick("Phone")}
              />
            </div>

            {providerMessage ? (
              <p
                role="status"
                className="text-muted-foreground text-center text-sm"
              >
                {providerMessage}
              </p>
            ) : null}

            <div className="my-2 grid grid-cols-[1fr_max-content_1fr] items-center">
              <div className="bg-border h-px" />
              <div className="mx-6 text-[13px] font-medium">OR</div>
              <div className="bg-border h-px" />
            </div>

            <div>
              <Input
                aria-invalid={!!state.fieldErrors?.email}
                aria-label="Email address"
                autoComplete="email"
                className={cn(
                  "border-border placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-foreground h-[58px] rounded-full border px-5 text-base shadow-none focus-visible:ring-1",
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

function ProviderButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <Button
      className="border-border bg-background hover:bg-muted/50 h-[58px] w-full gap-2 rounded-full border text-base font-medium shadow-none"
      onClick={onClick}
      type="button"
      variant="outline"
    >
      <span className="grid size-5 place-items-center">{icon}</span>
      <span>{label}</span>
    </Button>
  )
}

function GoogleMark({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.56 2.69-3.87 2.69-6.62Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86a5.38 5.38 0 0 1-5.06-3.72H.93v2.33A9 9 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.94 10.7A5.41 5.41 0 0 1 3.66 9c0-.59.1-1.16.28-1.7V4.97H.93A9 9 0 0 0 0 9c0 1.45.34 2.82.93 4.03l3.01-2.33Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.65 8.65 0 0 0 9 0 9 9 0 0 0 .93 4.97L3.94 7.3A5.38 5.38 0 0 1 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  )
}
