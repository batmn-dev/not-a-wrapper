"use client"

import { useAuthFormAction } from "@/app/auth/_components/use-auth-form-action"
import { initialAuthActionState } from "@/app/auth/_lib/schemas"
import { resendMagicAuthCode, verifyMagicAuthCode } from "@/app/auth/actions"
import { Button } from "@/components/ui/button"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { APP_DOMAIN } from "@/lib/config"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useActionState, useCallback, useRef } from "react"

type VerificationFormProps = {
  email: string
}

export function VerificationForm({ email }: VerificationFormProps) {
  const verifyFormRef = useRef<HTMLFormElement>(null)
  const [verifyState, verifyAction, isVerifyPending] = useAuthFormAction(
    verifyMagicAuthCode,
    initialAuthActionState
  )
  const [resendState, resendAction, isResendPending] = useActionState(
    resendMagicAuthCode,
    initialAuthActionState
  )
  const passwordHref = `/auth/login?email=${encodeURIComponent(email)}`
  const handleCodeComplete = useCallback(
    (code: string) => {
      if (isVerifyPending || !/^\d{6}$/.test(code)) return

      verifyFormRef.current?.requestSubmit()
    },
    [isVerifyPending]
  )

  return (
    <div className="w-full">
      {verifyState.message ? (
        <AuthStatusMessage state={verifyState} className="mb-5" />
      ) : null}

      <form
        action={verifyAction}
        className="space-y-5"
        noValidate
        ref={verifyFormRef}
      >
        <input name="email" type="hidden" value={email} />
        <div className="space-y-2">
          <InputOTP
            aria-invalid={!!verifyState.fieldErrors?.code}
            autoComplete="one-time-code"
            containerClassName="justify-center gap-2"
            inputMode="numeric"
            maxLength={6}
            name="code"
            onComplete={handleCodeComplete}
            pattern="[0-9]*"
            required
          >
            <InputOTPGroup className="gap-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <InputOTPSlot
                  className="h-12 w-11 rounded-xl border text-base shadow-none first:rounded-xl last:rounded-xl"
                  index={index}
                  key={index}
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {verifyState.fieldErrors?.code ? (
            <p role="alert" className="text-destructive text-center text-sm">
              {verifyState.fieldErrors.code}
            </p>
          ) : null}
        </div>

        <Button
          className="bg-primary text-primary-foreground hover:bg-primary-bg-hover h-[52px] w-full rounded-full text-base shadow-none"
          disabled={isVerifyPending}
          type="submit"
        >
          {isVerifyPending ? "Checking..." : "Continue"}
        </Button>
      </form>

      <form action={resendAction} className="mt-3">
        <input name="email" type="hidden" value={email} />
        <Button
          className="h-11 w-full rounded-full text-base"
          disabled={isResendPending}
          type="submit"
          variant="ghost"
        >
          {isResendPending ? "Sending..." : "Resend email"}
        </Button>
      </form>
      {resendState.message ? (
        <AuthStatusMessage state={resendState} className="mt-3" />
      ) : null}

      <div className="my-5 grid grid-cols-[1fr_max-content_1fr] items-center">
        <div className="bg-border h-px" />
        <div className="mx-6 text-[13px] font-medium">OR</div>
        <div className="bg-border h-px" />
      </div>

      <Button
        className="h-[52px] w-full rounded-full text-base shadow-none"
        render={<Link href={passwordHref} />}
        variant="outline"
      >
        Continue with password
      </Button>

      <div className="text-muted-foreground mt-12 flex items-center justify-center gap-3 text-sm">
        <a
          className="hover:text-foreground underline-offset-4 hover:underline"
          href={`${APP_DOMAIN}/terms`}
        >
          Terms of Use
        </a>
        <span aria-hidden="true">|</span>
        <a
          className="hover:text-foreground underline-offset-4 hover:underline"
          href={`${APP_DOMAIN}/privacy`}
        >
          Privacy Policy
        </a>
      </div>
    </div>
  )
}

function AuthStatusMessage({
  className,
  state,
}: {
  className?: string
  state: typeof initialAuthActionState
}) {
  if (!state.message) return null

  return (
    <p
      role={state.status === "success" ? "status" : "alert"}
      className={cn(
        "rounded-lg px-3 py-2 text-center text-sm",
        state.status === "success"
          ? "bg-primary/10 text-primary"
          : "bg-destructive/10 text-destructive",
        className
      )}
    >
      {state.message}
    </p>
  )
}
