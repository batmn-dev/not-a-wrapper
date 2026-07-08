"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useMessages } from "@/lib/chat-store/messages/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import type { Chat } from "@/lib/chat-store/types"
import { Pin, PinOff } from "@/lib/icons"
import {
  RiDeleteBinLine,
  RiEditLine,
  RiLoader4Line,
  RiMoreFill,
  RiShare2Line,
} from "@remixicon/react"
import { useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import type React from "react"
import { useState } from "react"
import { SharePublishDrawer } from "./share-publish-drawer"
import { DialogDeleteChat } from "./sidebar/dialog-delete-chat"
import {
  trailingIconButtonClassName,
  TrailingIconChip,
} from "./sidebar/trailing-icon-button"

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
  const { deleteMessages } = useMessages()
  const { deleteChat, togglePinned, updateTitle } = useChats()
  const { chatId } = useChatSession()
  const router = useRouter()
  const isMobile = useBreakpoint(768)
  const makePublicMutation = useMutation(api.chats.makePublic)

  const handleConfirmDelete = async () => {
    if (chat.id === chatId) {
      await deleteMessages()
    }
    await deleteChat(chat.id, chatId || undefined, () => router.push("/"))
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

  const defaultTrigger = (
    <button
      type="button"
      // ChatGPT's __menu-item-trailing-btn: a 34×36 hit area with NO background —
      // only the icon color shifts (tertiary→foreground) and the keyboard focus
      // ring lives on the inner chip (see TrailingIconChip). Shared with the pin
      // quick-action so the pair matches. Used only by the sidebar/project rows;
      // the header new-chat menu passes its own `trigger`, so it's unaffected.
      className={trailingIconButtonClassName}
      // The row is a single <a> (ChatGPT-style) with this button nested inside,
      // so a bare click would trigger the anchor's navigation. preventDefault
      // cancels that nav (and tells Next's Link to skip); stopPropagation keeps
      // it off the row. The menu still opens — base-ui triggers on pointer-down.
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      aria-label={triggerAriaLabel ?? "Open chat actions"}
    />
  )

  return (
    <>
      <DropdownMenu
        // shadcn/ui pointer-events-none issue on mobile
        modal={isMobile ? true : false}
        onOpenChange={onOpenChange}
      >
        <DropdownMenuTrigger render={trigger ?? defaultTrigger}>
          {/* No color class: the glyph inherits the trigger's currentColor so it
              tracks the tertiary→foreground hover shift (ChatGPT icon-color
              reveal). Wrapped in the chip that hosts the keyboard focus ring. */}
          {!trigger && (
            <TrailingIconChip>
              <Icon icon={RiMoreFill} slotSize={20} />
            </TrailingIconChip>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={contentSide}
          align={contentAlign}
          className="w-40"
          animated={false}
        >
          {showShare && (
            <DropdownMenuItem
              disabled={isShareLoading}
              onClick={(e) => {
                e.stopPropagation()
                handleShare()
              }}
            >
              {isShareLoading ? (
                <Icon
                  icon={RiLoader4Line}
                  slotSize={20}
                  className="animate-spin"
                />
              ) : (
                <Icon icon={RiShare2Line} slotSize={20} />
              )}
              Share
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              togglePinned(chat.id, !chat.pinned)
            }}
          >
            {chat.pinned ? <PinOff size={20} /> : <Pin size={20} />}
            {chat.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              handleRename()
            }}
          >
            <Icon icon={RiEditLine} slotSize={20} />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation()
              setIsDeleteDialogOpen(true)
            }}
          >
            <Icon icon={RiDeleteBinLine} slotSize={20} />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
