import { getWorkosSession } from "@/lib/auth/workos"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ResetPasswordForm } from "../_components/auth-forms"
import { AuthShell } from "../_components/auth-shell"

type ResetPasswordPageProps = {
  searchParams?: Promise<{
    token?: string | string[]
  }>
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const { user } = await getWorkosSession()
  if (user) redirect("/")

  const params = searchParams ? await searchParams : {}
  const token = typeof params.token === "string" ? params.token : ""

  return (
    <AuthShell title="Choose a new password">
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            This reset link is invalid or expired.
          </p>
          <Button render={<Link href="/auth/forgot-password" />}>
            Request a new link
          </Button>
        </div>
      )}
    </AuthShell>
  )
}
