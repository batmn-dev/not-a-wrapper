"use client"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { toast } from "@/components/ui/toast"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useMessages } from "@/lib/chat-store/messages/provider"
import { clearAllIndexedDBStores } from "@/lib/chat-store/persist"
import { RiLogoutBoxRLine } from "@remixicon/react"
import { useAuth } from "@workos-inc/authkit-nextjs/components"

export function AccountManagement() {
  const { signOut } = useAuth()
  const { resetChats } = useChats()
  const { resetMessages } = useMessages()

  const handleSignOut = async () => {
    try {
      await resetMessages()
      await resetChats()
      await clearAllIndexedDBStores()
      await signOut({ returnTo: "/" })
    } catch (e) {
      console.error("Sign out failed:", e)
      toast({ title: "Failed to sign out", status: "error" })
    }
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium text-balance">Account</h3>
        <p className="text-muted-foreground text-xs text-pretty">
          Log out on this device
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="flex items-center gap-2"
        onClick={handleSignOut}
      >
        <Icon icon={RiLogoutBoxRLine} slotSize={16} />
        <span>Sign out</span>
      </Button>
    </div>
  )
}
