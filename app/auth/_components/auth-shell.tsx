import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { APP_NAME } from "@/lib/config"
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
    <main className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="flex h-14 items-center px-4">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href="/" />}
          className="gap-2"
        >
          <Icon icon={RiArrowLeftLine} slotSize={18} />
          <span>Back</span>
        </Button>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <section className="w-full max-w-[400px]">
          <div className="mb-8 space-y-2 text-center">
            <p className="text-sm font-medium text-muted-foreground">
              {APP_NAME}
            </p>
            <h1 className="text-2xl leading-tight font-medium tracking-normal">
              {title}
            </h1>
            {description ? (
              <p className="text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>

          <div className="rounded-lg bg-card p-5 shadow-border-md">
            {children}
          </div>
        </section>
      </div>
    </main>
  )
}
