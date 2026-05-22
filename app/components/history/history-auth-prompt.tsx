"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import Link from "next/link"

type HistoryAuthPromptProps = {
  className?: string
}

export function HistoryAuthPrompt({ className }: HistoryAuthPromptProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-stretch px-6 pb-10 text-center",
        className
      )}
    >
      <div className="space-y-5">
        <h3 className="text-[30px] leading-9 font-normal tracking-normal text-foreground">
          Log in to search chats
        </h3>
        <p className="mx-auto max-w-[290px] text-base leading-6 text-foreground">
          Saved chat history is available after you log in or create an account.
        </p>
      </div>
      <div className="mt-5 flex flex-col gap-3">
        <Button
          className="h-[58px] w-full rounded-full bg-[#0d0d0d] text-base text-white shadow-none hover:bg-[#2f2f2f] dark:bg-white dark:text-black dark:hover:bg-white/90"
          render={<Link href="/login" />}
        >
          Log in
        </Button>
        <Button
          variant="outline"
          className="h-[58px] w-full rounded-full border border-border bg-background text-base font-medium shadow-none hover:bg-muted/50"
          render={<Link href="/sign-up" />}
        >
          Create account
        </Button>
      </div>
    </div>
  )
}
