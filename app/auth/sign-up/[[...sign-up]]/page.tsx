import { redirect } from "next/navigation"
import { SignUpForm } from "../../_components/auth-forms"
import { AuthShell } from "../../_components/auth-shell"
import { getWorkosSession } from "@/lib/auth/workos"

export default async function SignUpPage() {
  const { user } = await getWorkosSession()
  if (user) redirect("/")

  return (
    <AuthShell title="Create your account">
      <SignUpForm />
    </AuthShell>
  )
}
