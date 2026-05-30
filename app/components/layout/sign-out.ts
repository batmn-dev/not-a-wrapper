"use client"

import { toast } from "@/components/ui/toast"
import { clearAllIndexedDBStores } from "@/lib/chat-store/persist"

type SignOut = (options?: { returnTo?: string }) => Promise<void>
type ResetLocalState = () => Promise<void>

type SignOutAndClearLocalStateOptions = {
  resetChats: ResetLocalState
  resetMessages: ResetLocalState
  signOut: SignOut
  returnTo?: string
}

export function isNextRedirectError(error: unknown) {
  if (typeof error !== "object" || error === null || !("digest" in error)) {
    return false
  }

  const digest = (error as { digest?: unknown }).digest
  if (typeof digest !== "string") return false

  const [code, type] = digest.split(";")
  return code === "NEXT_REDIRECT" && (type === "push" || type === "replace")
}

export async function signOutAndClearLocalState({
  resetChats,
  resetMessages,
  signOut,
  returnTo = "/",
}: SignOutAndClearLocalStateOptions) {
  try {
    await resetMessages()
    await resetChats()
    await clearAllIndexedDBStores()
  } catch (error) {
    console.error("Sign out cleanup failed:", error)
    toast({ title: "Failed to sign out", status: "error" })
    return
  }

  try {
    await signOut({ returnTo })
  } catch (error) {
    if (isNextRedirectError(error)) return

    console.error("Sign out failed:", error)
    toast({ title: "Failed to sign out", status: "error" })
  }
}
