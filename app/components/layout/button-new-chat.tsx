"use client"

import { ChatActionsMenu } from "@/app/components/layout/chat-actions-menu"
import { headerActionButtonClassName } from "@/app/components/layout/header-action-button"
import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { useKeyShortcut } from "@/app/hooks/use-key-shortcut"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { RiMoreFill } from "@remixicon/react"
import { usePathname, useRouter } from "next/navigation"

export function ButtonNewChat() {
  const pathname = usePathname()
  const router = useRouter()
  const { chatId } = useChatSession()
  const { getChatById } = useChats()
  const chat = chatId ? getChatById(chatId) : undefined
  const isMobile = useBreakpoint(768)

  useKeyShortcut(
    (e) => (e.key === "u" || e.key === "U") && e.metaKey && e.shiftKey,
    () => router.push("/")
  )

  if (pathname === "/" || !chat) return null

  return (
    <ChatActionsMenu
      chat={chat}
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`${headerActionButtonClassName} p-1.5`}
          aria-label="Chat actions"
        >
          <Icon icon={RiMoreFill} slotSize={20} />
        </Button>
      }
      contentSide="bottom"
      contentAlign="end"
      showShare={isMobile}
    />
  )
}
