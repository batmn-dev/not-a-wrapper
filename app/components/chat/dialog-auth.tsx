"use client"

import { AuthModal } from "@/app/auth/_components/auth-modal"

type DialogAuthProps = {
  open: boolean
  setOpen: (open: boolean) => void
}

export function DialogAuth({ open, setOpen }: DialogAuthProps) {
  return (
    <AuthModal
      open={open}
      onOpenChange={setOpen}
      title="You've reached the limit for today"
      description="Log in or create an account to increase your message limits."
    />
  )
}
