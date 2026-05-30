import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { APP_DOMAIN } from "@/lib/config"
import { RiArrowLeftLine } from "@remixicon/react"
import Link from "next/link"
import type { ReactNode } from "react"

type AuthShellProps = {
  title: string
  description?: string
  children: ReactNode
}

export function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <main className="relative flex min-h-svh flex-col bg-background text-foreground">
      <header className="absolute top-0 left-0 z-10 flex h-14 items-center px-4">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href="/" />}
          className="gap-2 rounded-full px-3 text-muted-foreground hover:text-foreground"
        >
          <Icon icon={RiArrowLeftLine} slotSize={18} />
          <span>Back</span>
        </Button>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:py-12">
        <section className="mx-auto w-full max-w-[388px]">
          <div className="mb-8 space-y-3 text-center">
            <h1 className="text-[32px] leading-10 font-normal tracking-normal">
              {title}
            </h1>
            {description ? (
              <p className="mx-auto max-w-[320px] text-base leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>

          {children}

          <footer className="mt-12 flex items-center justify-center gap-3 text-sm text-muted-foreground">
            <a
              className="underline-offset-4 hover:text-foreground hover:underline"
              href={`${APP_DOMAIN}/terms`}
            >
              Terms of Use
            </a>
            <span aria-hidden="true">|</span>
            <a
              className="underline-offset-4 hover:text-foreground hover:underline"
              href={`${APP_DOMAIN}/privacy`}
            >
              Privacy Policy
            </a>
          </footer>
        </section>
      </div>
    </main>
  )
}
