"use client"

import { AuthModalTrigger } from "@/app/auth/_components/auth-modal"
import { cn } from "@/lib/utils"

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
        <h3 className="text-foreground text-[30px] leading-9 font-normal tracking-normal">
          Log in to search chats
        </h3>
        <p className="text-foreground mx-auto max-w-[290px] text-base leading-6">
          Saved chat history is available after you log in or create an account.
        </p>
      </div>
      <div className="mt-5 flex flex-col gap-3">
        <AuthModalTrigger className="bg-primary text-primary-foreground hover:bg-primary-bg-hover h-[58px] w-full rounded-full text-base shadow-none">
          Log in
        </AuthModalTrigger>
        <AuthModalTrigger
          variant="outline"
          className="border-border bg-background hover:bg-interactive-hover h-[58px] w-full rounded-full border text-base font-medium shadow-none"
        >
          Create account
        </AuthModalTrigger>
      </div>
    </div>
  )
}
