import { Button } from "@/components/ui/button"
import { getWorkosSession } from "@/lib/auth/workos"
import Link from "next/link"
import { redirect } from "next/navigation"
import { VerifyEmailForm } from "../_components/auth-forms"
import { AuthShell } from "../_components/auth-shell"
import { getEmailVerificationFlowCookie } from "../_lib/auth-flow-cookie"

type VerifyEmailPageProps = {
  searchParams?: Promise<{
    email?: string
  }>
}

export default async function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  const { user } = await getWorkosSession()
  if (user) redirect("/")

  const flow = await getEmailVerificationFlowCookie()
  const params = searchParams ? await searchParams : {}
  const email = flow?.email ?? params.email

  return (
    <AuthShell
      title="Verify your email"
      description="Enter the code from your email to finish signing in."
    >
      {flow ? (
        <VerifyEmailForm email={email} />
      ) : (
        <div className="space-y-4 text-center">
          <p className="text-muted-foreground text-sm">
            That verification session expired. Sign in again to request a new
            code.
          </p>
          <Button render={<Link href="/auth/login" />}>Log in</Button>
        </div>
      )}
    </AuthShell>
  )
}
