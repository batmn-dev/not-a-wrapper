import { getWorkosSession } from "@/lib/auth/workos"
import { redirect } from "next/navigation"
import { SignUpForm } from "../../_components/auth-forms"
import { AuthShell } from "../../_components/auth-shell"

export default async function SignUpPage() {
  const { user } = await getWorkosSession()
  if (user) redirect("/")

  return (
    <AuthShell
      title="Create your account"
      description="Start with a provider, or create an account with email and password."
    >
      <SignUpForm />
    </AuthShell>
  )
}
