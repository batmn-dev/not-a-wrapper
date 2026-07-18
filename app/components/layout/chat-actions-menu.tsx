"use client"

import { Icon } from "@/components/ui/icon"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useMessages } from "@/lib/chat-store/messages/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import type { Chat } from "@/lib/chat-store/types"
import { Pin, PinOff } from "@/lib/icons"
import { RiDeleteBinLine, RiEditLine, RiShare2Line } from "@remixicon/react"
import { useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import type React from "react"
import { useState } from "react"
import { RowActionsMenu, type RowActionItem } from "./row-actions-menu"
import { SharePublishDrawer } from "./share-publish-drawer"
import { DialogDeleteChat } from "./sidebar/dialog-delete-chat"

type ChatActionsMenuProps = {
  chat: Chat
  onRename?: () => void
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactElement
  triggerAriaLabel?: string
  contentAlign?: "start" | "center" | "end"
  contentSide?: "top" | "right" | "bottom" | "left"
  showShare?: boolean
}

// Chat adapter over the Row-actions menu: builds the Share/Pin/Rename/Delete
// item set and owns the chat-specific handlers, delete dialog, and share drawer.
export function ChatActionsMenu({
  chat,
  onRename,
  onOpenChange,
  trigger,
  triggerAriaLabel,
  contentAlign = "start",
  contentSide = "bottom",
  showShare,
}: ChatActionsMenuProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isShareDrawerOpen, setIsShareDrawerOpen] = useState(false)
  const [isShareLoading, setIsShareLoading] = useState(false)
  const { resetMessages } = useMessages()
  const { deleteChat, togglePinned, updateTitle } = useChats()
  const { chatId } = useChatSession()
  const router = useRouter()
  const makePublicMutation = useMutation(api.chats.makePublic)

  const handleConfirmDelete = async () => {
    const deleted = await deleteChat(
      chat.id,
      chatId || undefined,
      () => router.push("/")
    )
    if (deleted && chat.id === chatId) {
      await resetMessages()
    }
  }

  const handleShare = async () => {
    setIsShareLoading(true)
    try {
      await makePublicMutation({ chatId: chat.id as Id<"chats"> })
      setIsShareDrawerOpen(true)
    } catch (error) {
      console.error("Failed to make chat public:", error)
    } finally {
      setIsShareLoading(false)
    }
  }

  const handleRename = () => {
    if (onRename) {
      onRename()
      return
    }

    const nextTitle = window.prompt(
      "Rename chat",
      chat.title || "Untitled chat"
    )
    if (nextTitle === null) return

    const title = nextTitle.trim()
    if (!title || title === chat.title) return
    void updateTitle(chat.id, title)
  }

  const items: RowActionItem[] = [
    ...(showShare
      ? [
          {
            key: "share",
            icon: <Icon icon={RiShare2Line} slotSize={20} />,
            label: "Share",
            onSelect: handleShare,
            loading: isShareLoading,
            disabled: isShareLoading,
          } satisfies RowActionItem,
        ]
      : []),
    {
      key: "rename",
      icon: <Icon icon={RiEditLine} slotSize={20} />,
      label: "Rename",
      onSelect: handleRename,
    },
    {
      key: "pin",
      icon: chat.pinned ? <PinOff size={20} /> : <Pin size={20} />,
      label: chat.pinned ? "Unpin" : "Pin",
      onSelect: () => togglePinned(chat.id, !chat.pinned),
    },
    {
      key: "delete",
      icon: <Icon icon={RiDeleteBinLine} slotSize={20} />,
      label: "Delete",
      variant: "destructive",
      separatorBefore: true,
      onSelect: () => setIsDeleteDialogOpen(true),
    },
  ]

  return (
    <>
      <RowActionsMenu
        items={items}
        trigger={trigger}
        triggerAriaLabel={triggerAriaLabel ?? "Open chat actions"}
        contentAlign={contentAlign}
        contentSide={contentSide}
        onOpenChange={onOpenChange}
      />

      <DialogDeleteChat
        isOpen={isDeleteDialogOpen}
        setIsOpen={setIsDeleteDialogOpen}
        chatTitle={chat.title || "Untitled chat"}
        onConfirmDelete={handleConfirmDelete}
      />

      {showShare && (
        <SharePublishDrawer
          open={isShareDrawerOpen}
          onOpenChange={setIsShareDrawerOpen}
          chatId={chat.id}
        />
      )}
    </>
  )
}
