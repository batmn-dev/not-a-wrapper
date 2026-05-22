import { getWorkosSession } from "@/lib/auth/workos"
import { redirect } from "next/navigation"
import { ForgotPasswordForm } from "../_components/auth-forms"
import { AuthShell } from "../_components/auth-shell"

export default async function ForgotPasswordPage() {
  const { user } = await getWorkosSession()
  if (user) redirect("/")

  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email for your account."
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
