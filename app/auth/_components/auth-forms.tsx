"use client"

import {
  requestPasswordReset,
  resetPassword,
  signInWithPassword,
  signUpWithPassword,
  verifyEmailCode,
} from "@/app/auth/actions"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { initialAuthActionState, type AuthActionState } from "../_lib/schemas"
import Link from "next/link"
import { useActionState } from "react"

function FormMessage({ state }: { state: AuthActionState }) {
  if (!state.message) return null

  return (
    <p
      role="status"
      className={
        state.status === "success"
          ? "rounded-md bg-primary/10 px-3 py-2 text-sm text-primary"
          : "rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
      }
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
    <Button type="submit" className="w-full" size="lg" disabled={isPending}>
      {isPending ? "Please wait..." : children}
    </Button>
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
  const [state, formAction, isPending] = useActionState(
    signInWithPassword,
    initialState
  )

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage state={state} />

      <Field data-invalid={!!state.fieldErrors?.email}>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={initialEmail}
          aria-invalid={!!state.fieldErrors?.email}
          required
        />
        <FieldError>{state.fieldErrors?.email}</FieldError>
      </Field>

      <Field data-invalid={!!state.fieldErrors?.password}>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Link
            href="/auth/forgot-password"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!state.fieldErrors?.password}
          required
        />
        <FieldError>{state.fieldErrors?.password}</FieldError>
      </Field>

      <SubmitButton isPending={isPending}>Log in</SubmitButton>

      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link
          href="/auth/sign-up"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  )
}

export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(
    signUpWithPassword,
    initialAuthActionState
  )

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage state={state} />

      <Field data-invalid={!!state.fieldErrors?.name}>
        <FieldLabel htmlFor="name">Name</FieldLabel>
        <Input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          aria-invalid={!!state.fieldErrors?.name}
        />
        <FieldError>{state.fieldErrors?.name}</FieldError>
      </Field>

      <Field data-invalid={!!state.fieldErrors?.email}>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          aria-invalid={!!state.fieldErrors?.email}
          required
        />
        <FieldError>{state.fieldErrors?.email}</FieldError>
      </Field>

      <Field data-invalid={!!state.fieldErrors?.password}>
        <FieldLabel htmlFor="password">Password</FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!state.fieldErrors?.password}
          required
        />
        <FieldDescription>Use at least 8 characters.</FieldDescription>
        <FieldError>{state.fieldErrors?.password}</FieldError>
      </Field>

      <Field data-invalid={!!state.fieldErrors?.confirmPassword}>
        <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!state.fieldErrors?.confirmPassword}
          required
        />
        <FieldError>{state.fieldErrors?.confirmPassword}</FieldError>
      </Field>

      <SubmitButton isPending={isPending}>Create account</SubmitButton>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/auth/login"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Log in
        </Link>
      </p>
    </form>
  )
}

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordReset,
    initialAuthActionState
  )

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage state={state} />

      <Field data-invalid={!!state.fieldErrors?.email}>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          aria-invalid={!!state.fieldErrors?.email}
          required
        />
        <FieldError>{state.fieldErrors?.email}</FieldError>
      </Field>

      <SubmitButton isPending={isPending}>Send reset link</SubmitButton>

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link
          href="/auth/login"
          className="text-foreground underline-offset-4 hover:underline"
        >
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
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} />

      {state.fieldErrors?.token ? (
        <FieldError>{state.fieldErrors.token}</FieldError>
      ) : null}

      <Field data-invalid={!!state.fieldErrors?.password}>
        <FieldLabel htmlFor="password">New password</FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!state.fieldErrors?.password}
          required
        />
        <FieldDescription>Use at least 8 characters.</FieldDescription>
        <FieldError>{state.fieldErrors?.password}</FieldError>
      </Field>

      <Field data-invalid={!!state.fieldErrors?.confirmPassword}>
        <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!state.fieldErrors?.confirmPassword}
          required
        />
        <FieldError>{state.fieldErrors?.confirmPassword}</FieldError>
      </Field>

      <SubmitButton isPending={isPending}>Reset password</SubmitButton>
    </form>
  )
}

export function VerifyEmailForm({ email }: { email?: string }) {
  const [state, formAction, isPending] = useActionState(
    verifyEmailCode,
    initialAuthActionState
  )

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage state={state} />

      {email ? (
        <p className="text-center text-sm text-muted-foreground">
          Code sent to <span className="text-foreground">{email}</span>
        </p>
      ) : null}

      <Field data-invalid={!!state.fieldErrors?.code}>
        <FieldLabel htmlFor="code">Verification code</FieldLabel>
        <InputOTP
          id="code"
          name="code"
          maxLength={6}
          inputMode="numeric"
          pattern="[0-9]*"
          aria-invalid={!!state.fieldErrors?.code}
          containerClassName="justify-center"
          required
        >
          <InputOTPGroup>
            {Array.from({ length: 6 }).map((_, index) => (
              <InputOTPSlot key={index} index={index} />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <FieldError>{state.fieldErrors?.code}</FieldError>
      </Field>

      <SubmitButton isPending={isPending}>Verify email</SubmitButton>

      <p className="text-center text-sm text-muted-foreground">
        Need a new code?{" "}
        <Link
          href="/auth/login"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Sign in again
        </Link>
      </p>
    </form>
  )
}
