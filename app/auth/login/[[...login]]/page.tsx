import { getWorkosSession } from "@/lib/auth/workos"
import { redirect } from "next/navigation"
import { LoginForm } from "../../_components/auth-forms"
import { AuthShell } from "../../_components/auth-shell"

type LoginPageProps = {
  searchParams?: Promise<{
    email?: string
    magic?: string
    reset?: string
  }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { user } = await getWorkosSession()
  if (user) redirect("/")

  const params = searchParams ? await searchParams : {}
  const notice =
    params.reset === "complete"
      ? "Your password has been reset. Log in with your new password."
      : params.magic === "unavailable"
        ? "Email code sign-in is not enabled yet. Log in with your password."
        : undefined
  const noticeStatus = params.magic === "unavailable" ? "error" : "success"
  const email = typeof params.email === "string" ? params.email : undefined

  return (
    <AuthShell
      title="Log in to your account"
      description="Use a provider, or continue with your email and password."
    >
      <LoginForm
        initialEmail={email}
        notice={notice}
        noticeStatus={noticeStatus}
      />
    </AuthShell>
  )
}
