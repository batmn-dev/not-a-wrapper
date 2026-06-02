"use client"

import {
  requestPasswordReset,
  resetPassword,
  signInWithPassword,
  signUpWithPassword,
  verifyEmailCode,
} from "@/app/auth/actions"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { cn } from "@/lib/utils"
import { RiAppleFill, RiPhoneLine } from "@remixicon/react"
import Link from "next/link"
import { useActionState, useState, type ReactNode } from "react"
import { initialAuthActionState, type AuthActionState } from "../_lib/schemas"
import { useAuthFormAction } from "./use-auth-form-action"

const PROVIDER_GOOGLE_MARK_SIZE = 18
const authFieldClassName = "gap-2"
const authLabelClassName = "px-5 text-sm font-medium text-muted-foreground"
const authInputClassName =
  "h-[52px] rounded-full border border-border px-5 text-base shadow-none placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive"
const authFieldErrorClassName = "px-5"
const authLinkClassName =
  "font-medium text-foreground underline-offset-4 hover:underline"
const authSecondaryLinkClassName =
  "text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
const authPrimaryButtonClassName =
  "h-[52px] w-full rounded-full bg-[#0d0d0d] text-base text-white shadow-none hover:bg-[#2f2f2f] dark:bg-white dark:text-black dark:hover:bg-white/90"
const authProviderButtonClassName =
  "h-[52px] w-full gap-2 rounded-full border border-border bg-background text-base font-medium shadow-none hover:bg-muted/50"

function FormMessage({ state }: { state: AuthActionState }) {
  if (!state.message) return null

  return (
    <p
      role={state.status === "success" ? "status" : "alert"}
      className={cn(
        "rounded-lg px-3 py-2 text-center text-sm",
        state.status === "success"
          ? "bg-primary/10 text-primary"
          : "bg-destructive/10 text-destructive"
      )}
    >
      {state.message}
    </p>
  )
}

function SubmitButton({
  children,
  isPending,
}: {
  children: string
  isPending: boolean
}) {
  return (
    <Button
      type="submit"
      className={authPrimaryButtonClassName}
      disabled={isPending}
    >
      {isPending ? "Please wait..." : children}
    </Button>
  )
}

function SocialAuthOptions() {
  const [providerMessage, setProviderMessage] = useState<string | null>(null)

  const handleProviderClick = (provider: string) => {
    setProviderMessage(
      `${provider} sign-in is not available yet. Continue with email below.`
    )
  }

  return (
    <div className="space-y-5">
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
        <p role="status" className="text-muted-foreground text-center text-sm">
          {providerMessage}
        </p>
      ) : null}

      <div className="grid grid-cols-[1fr_max-content_1fr] items-center">
        <div className="bg-border h-px" />
        <div className="mx-6 text-[13px] font-medium">OR</div>
        <div className="bg-border h-px" />
      </div>
    </div>
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
      className={authProviderButtonClassName}
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

type LoginFormProps = {
  initialEmail?: string
  notice?: string
  noticeStatus?: Extract<AuthActionState["status"], "error" | "success">
}

export function LoginForm({
  initialEmail,
  notice,
  noticeStatus = "success",
}: LoginFormProps) {
  const initialState: AuthActionState = notice
    ? { status: noticeStatus, message: notice }
    : initialAuthActionState
  const [state, formAction, isPending] = useAuthFormAction(
    signInWithPassword,
    initialState
  )

  return (
    <div className="space-y-5">
      <SocialAuthOptions />

      <form action={formAction} className="space-y-5" noValidate>
        <FormMessage state={state} />

        <Field
          className={authFieldClassName}
          data-invalid={!!state.fieldErrors?.email}
        >
          <FieldLabel className={authLabelClassName} htmlFor="email">
            Email
          </FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className={authInputClassName}
            defaultValue={initialEmail}
            aria-invalid={!!state.fieldErrors?.email}
            required
          />
          <FieldError className={authFieldErrorClassName}>
            {state.fieldErrors?.email}
          </FieldError>
        </Field>

        <Field
          className={authFieldClassName}
          data-invalid={!!state.fieldErrors?.password}
        >
          <div className="flex items-center justify-between gap-3">
            <FieldLabel className={authLabelClassName} htmlFor="password">
              Password
            </FieldLabel>
            <Link
              href="/auth/forgot-password"
              className={authSecondaryLinkClassName}
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            className={authInputClassName}
            aria-invalid={!!state.fieldErrors?.password}
            required
          />
          <FieldError className={authFieldErrorClassName}>
            {state.fieldErrors?.password}
          </FieldError>
        </Field>

        <SubmitButton isPending={isPending}>Log in</SubmitButton>

        <p className="text-muted-foreground text-center text-sm">
          New here?{" "}
          <Link href="/auth/sign-up" className={authLinkClassName}>
            Create an account
          </Link>
        </p>
      </form>
    </div>
  )
}

export function SignUpForm() {
  const [state, formAction, isPending] = useAuthFormAction(
    signUpWithPassword,
    initialAuthActionState
  )

  return (
    <div className="space-y-5">
      <SocialAuthOptions />

      <form action={formAction} className="space-y-5" noValidate>
        <FormMessage state={state} />

        <Field
          className={authFieldClassName}
          data-invalid={!!state.fieldErrors?.name}
        >
          <FieldLabel className={authLabelClassName} htmlFor="name">
            Name
          </FieldLabel>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            className={authInputClassName}
            aria-invalid={!!state.fieldErrors?.name}
          />
          <FieldError className={authFieldErrorClassName}>
            {state.fieldErrors?.name}
          </FieldError>
        </Field>

        <Field
          className={authFieldClassName}
          data-invalid={!!state.fieldErrors?.email}
        >
          <FieldLabel className={authLabelClassName} htmlFor="email">
            Email
          </FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className={authInputClassName}
            aria-invalid={!!state.fieldErrors?.email}
            required
          />
          <FieldError className={authFieldErrorClassName}>
            {state.fieldErrors?.email}
          </FieldError>
        </Field>

        <Field
          className={authFieldClassName}
          data-invalid={!!state.fieldErrors?.password}
        >
          <FieldLabel className={authLabelClassName} htmlFor="password">
            Password
          </FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            className={authInputClassName}
            aria-invalid={!!state.fieldErrors?.password}
            required
          />
          <FieldDescription className="px-5">
            Use at least 8 characters.
          </FieldDescription>
          <FieldError className={authFieldErrorClassName}>
            {state.fieldErrors?.password}
          </FieldError>
        </Field>

        <Field
          className={authFieldClassName}
          data-invalid={!!state.fieldErrors?.confirmPassword}
        >
          <FieldLabel className={authLabelClassName} htmlFor="confirmPassword">
            Confirm password
          </FieldLabel>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            className={authInputClassName}
            aria-invalid={!!state.fieldErrors?.confirmPassword}
            required
          />
          <FieldError className={authFieldErrorClassName}>
            {state.fieldErrors?.confirmPassword}
          </FieldError>
        </Field>

        <SubmitButton isPending={isPending}>Create account</SubmitButton>

        <p className="text-muted-foreground text-center text-sm">
          Already have an account?{" "}
          <Link href="/auth/login" className={authLinkClassName}>
            Log in
          </Link>
        </p>
      </form>
    </div>
  )
}

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordReset,
    initialAuthActionState
  )

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />

      <Field
        className={authFieldClassName}
        data-invalid={!!state.fieldErrors?.email}
      >
        <FieldLabel className={authLabelClassName} htmlFor="email">
          Email
        </FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          className={authInputClassName}
          aria-invalid={!!state.fieldErrors?.email}
          required
        />
        <FieldError className={authFieldErrorClassName}>
          {state.fieldErrors?.email}
        </FieldError>
      </Field>

      <SubmitButton isPending={isPending}>Send reset link</SubmitButton>

      <p className="text-muted-foreground text-center text-sm">
        Remembered it?{" "}
        <Link href="/auth/login" className={authLinkClassName}>
          Log in
        </Link>
      </p>
    </form>
  )
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(
    resetPassword,
    initialAuthActionState
  )

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} />

      {state.fieldErrors?.token ? (
        <FieldError>{state.fieldErrors.token}</FieldError>
      ) : null}

      <Field
        className={authFieldClassName}
        data-invalid={!!state.fieldErrors?.password}
      >
        <FieldLabel className={authLabelClassName} htmlFor="password">
          New password
        </FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          className={authInputClassName}
          aria-invalid={!!state.fieldErrors?.password}
          required
        />
        <FieldDescription className="px-5">
          Use at least 8 characters.
        </FieldDescription>
        <FieldError className={authFieldErrorClassName}>
          {state.fieldErrors?.password}
        </FieldError>
      </Field>

      <Field
        className={authFieldClassName}
        data-invalid={!!state.fieldErrors?.confirmPassword}
      >
        <FieldLabel className={authLabelClassName} htmlFor="confirmPassword">
          Confirm password
        </FieldLabel>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          className={authInputClassName}
          aria-invalid={!!state.fieldErrors?.confirmPassword}
          required
        />
        <FieldError className={authFieldErrorClassName}>
          {state.fieldErrors?.confirmPassword}
        </FieldError>
      </Field>

      <SubmitButton isPending={isPending}>Reset password</SubmitButton>
    </form>
  )
}

export function VerifyEmailForm({ email }: { email?: string }) {
  const [state, formAction, isPending] = useAuthFormAction(
    verifyEmailCode,
    initialAuthActionState
  )

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />

      {email ? (
        <p className="text-muted-foreground text-center text-sm">
          Code sent to <span className="text-foreground">{email}</span>
        </p>
      ) : null}

      <Field
        className={authFieldClassName}
        data-invalid={!!state.fieldErrors?.code}
      >
        <FieldLabel className="sr-only" htmlFor="code">
          Verification code
        </FieldLabel>
        <InputOTP
          id="code"
          name="code"
          maxLength={6}
          inputMode="numeric"
          pattern="[0-9]*"
          aria-invalid={!!state.fieldErrors?.code}
          containerClassName="justify-center gap-2"
          required
        >
          <InputOTPGroup className="gap-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <InputOTPSlot
                key={index}
                index={index}
                className="h-12 w-11 rounded-xl border text-base shadow-none first:rounded-xl last:rounded-xl"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <FieldError className="text-center">
          {state.fieldErrors?.code}
        </FieldError>
      </Field>

      <SubmitButton isPending={isPending}>Verify email</SubmitButton>

      <p className="text-muted-foreground text-center text-sm">
        Need a new code?{" "}
        <Link href="/auth/login" className={authLinkClassName}>
          Sign in again
        </Link>
      </p>
    </form>
  )
}
