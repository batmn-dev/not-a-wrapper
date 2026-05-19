"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { RiSearchLine } from "@remixicon/react"
import Link from "next/link"

type HistoryAuthPromptProps = {
  className?: string
}

export function HistoryAuthPrompt({ className }: HistoryAuthPromptProps) {
  return (
    <div
      className={cn(
        "flex min-h-[360px] flex-col items-center justify-center px-6 py-10 text-center",
        className
      )}
    >
      <div className="bg-muted text-muted-foreground mb-5 flex size-11 items-center justify-center rounded-lg">
        <RiSearchLine size={22} className="size-5.5" aria-hidden="true" />
      </div>
      <div className="max-w-sm">
        <h3 className="text-foreground text-base font-medium">
          Log in to search chats
        </h3>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Saved chat history is available after you log in or create an account.
        </p>
      </div>
      <div className="mt-6 flex w-full max-w-xs flex-col gap-2 sm:flex-row">
        <Button className="flex-1" render={<Link href="/login" />}>
          Log in
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          render={<Link href="/sign-up" />}
        >
          Create account
        </Button>
      </div>
    </div>
  )
}
