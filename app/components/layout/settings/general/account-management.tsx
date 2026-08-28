"use client"

import { Button } from "@/components/ui/button"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useMessages } from "@/lib/chat-store/messages/provider"
import { RiLogoutBoxRLine } from "@remixicon/react"
import { useAuth } from "@workos-inc/authkit-nextjs/components"
import { SidebarLeadingIcon } from "../../sidebar/sidebar-leading-icon"
import { signOutAndClearLocalState } from "../../sign-out"

export function SettingsSignOutButton() {
  const { signOut } = useAuth()
  const { resetChats } = useChats()
  const { resetMessages } = useMessages()

  const handleSignOut = async () => {
    await signOutAndClearLocalState({ resetMessages, resetChats, signOut })
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      pressMotion="none"
      className="sidebar-row sidebar-menu-row sidebar-row-content sidebar-row-primary-control menu-item-hoverable text-destructive hover:text-destructive w-full justify-start gap-0 text-left font-normal hover:bg-[var(--sidebar-row-active-background)] focus-visible:shadow-none! focus-visible:ring-0! active:bg-[var(--sidebar-row-active-background)]"
      onClick={handleSignOut}
    >
      <SidebarLeadingIcon icon={RiLogoutBoxRLine} />
      <span>Sign out</span>
    </Button>
  )
}
