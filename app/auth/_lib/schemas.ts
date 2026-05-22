import { z } from "zod"

const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email.")
  .email("Enter a valid email.")
  .transform((value) => value.toLowerCase())

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or fewer.")

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
})

export const signUpSchema = z
  .object({
    name: z.string().trim().max(120, "Name must be 120 characters or fewer."),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  })

export const forgotPasswordSchema = z.object({
  email: emailSchema,
})

export const magicAuthStartSchema = z.object({
  email: emailSchema,
})

export const magicAuthVerifySchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code."),
})

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1, "This reset link is invalid."),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  })

export const verifyEmailSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code."),
})

export type AuthFieldErrors = Partial<
  Record<
    "name" | "email" | "password" | "confirmPassword" | "code" | "token",
    string
  >
>

export type AuthActionState = {
  status: "idle" | "error" | "success"
  message?: string
  fieldErrors?: AuthFieldErrors
}

export const initialAuthActionState: AuthActionState = {
  status: "idle",
}

export function fieldErrorsFromZodError(error: z.ZodError): AuthFieldErrors {
  const fieldErrors: AuthFieldErrors = {}

  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== "string") continue
    if (field in fieldErrors) continue

    fieldErrors[field as keyof AuthFieldErrors] = issue.message
  }

  return fieldErrors
}

export function splitFullName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const firstName = parts[0]
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : undefined

  return {
    firstName,
    lastName,
  }
}
