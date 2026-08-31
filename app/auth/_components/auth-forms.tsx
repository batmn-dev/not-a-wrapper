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
import Link from "next/link"
import { useActionState, useState } from "react"
import { initialAuthActionState, type AuthActionState } from "../_lib/schemas"
import {
  AuthProviderDivider,
  AuthProviderOptions,
  AuthProviderStatus,
  type AuthProviderName,
} from "./auth-provider-options"
import { useAuthFormAction } from "./use-auth-form-action"

const authFieldClassName = "gap-2"
const authLabelClassName = "px-5 text-sm font-medium text-muted-foreground"
const authInputClassName =
  "h-[52px] rounded-full border border-border px-5 text-base shadow-none focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive"
const authFieldErrorClassName = "px-5"
const authLinkClassName =
  "font-medium text-foreground underline-offset-4 hover:underline"
const authSecondaryLinkClassName =
  "text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
const authPrimaryButtonClassName =
  "h-[52px] w-full rounded-full bg-[#0d0d0d] text-base text-white shadow-none hover:bg-[#2f2f2f] dark:bg-white dark:text-black dark:hover:bg-white/90"
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

  const handleProviderClick = (provider: AuthProviderName) => {
    setProviderMessage(
      `${provider} sign-in is not available yet. Continue with email below.`
    )
  }

  return (
    <div className="space-y-5">
      <AuthProviderOptions
        buttonClassName="h-[52px]"
        onUnavailable={handleProviderClick}
      />
      <AuthProviderStatus message={providerMessage} />
      <AuthProviderDivider />
    </div>
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
