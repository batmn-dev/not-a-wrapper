import { magicAuthStartSchema } from "@/app/auth/_lib/schemas"
import { getWorkosSession } from "@/lib/auth/workos"
import Link from "next/link"
import { redirect } from "next/navigation"
import { VerificationForm } from "./verification-form"

type EmailVerificationPageProps = {
  searchParams?: Promise<{
    email?: string
  }>
}

export default async function EmailVerificationPage({
  searchParams,
}: EmailVerificationPageProps) {
  const { user } = await getWorkosSession()
  if (user) redirect("/")

  const params = searchParams ? await searchParams : {}
  const parsed = magicAuthStartSchema.safeParse({ email: params.email ?? "" })
  const email = parsed.success ? parsed.data.email : null

  return (
    <main className="flex min-h-svh w-full items-center justify-center bg-background px-4 py-10 text-foreground">
      <section className="mx-auto w-full max-w-[388px]">
        <div className="mb-8 space-y-3 text-center">
          <h1 className="text-[32px] leading-10 font-normal tracking-normal">
            Check your inbox
          </h1>
          <p className="mx-auto max-w-[320px] text-base leading-6 text-muted-foreground">
            {email ? (
              <>
                Enter the verification code we just sent to{" "}
                <span className="text-foreground">{email}</span>.
              </>
            ) : (
              "Open the login modal again to request a verification code."
            )}
          </p>
        </div>

        {email ? (
          <VerificationForm email={email} />
        ) : (
          <div className="text-center">
            <Link
              className="text-sm font-medium underline-offset-4 hover:underline"
              href="/"
            >
              Return home
            </Link>
          </div>
        )}
      </section>
    </main>
  )
}
