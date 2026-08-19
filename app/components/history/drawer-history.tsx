import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { Chats } from "@/lib/chat-store/types"
import { Pin, PinOff } from "@/lib/icons"
import {
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiEditLine,
  RiSearchLine,
} from "@remixicon/react"
import Link from "next/link"
import React, { useCallback, useRef, useState } from "react"
import { HistoryAuthPrompt } from "./history-auth-prompt"
import { useInfiniteScroll, type HistoryView } from "./use-history-view"
import { formatDate } from "./utils"

type DrawerHistoryProps = {
  history: HistoryView
  onSaveEdit: (id: string, newTitle: string) => Promise<void>
  onConfirmDelete: (id: string) => Promise<void>
  trigger?: React.ReactElement
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  isAuthenticated: boolean
}

export function DrawerHistory({
  history,
  onSaveEdit,
  onConfirmDelete,
  trigger,
  isOpen,
  setIsOpen,
  isAuthenticated,
}: DrawerHistoryProps) {
  const { togglePinned } = useChats()
  const { query, setQuery, view, loadMore, canLoadMore } = history
  const viewportRef = useRef<HTMLDivElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { chatId: currentChatId } = useChatSession()

  // Browse mode loads more pages as the user scrolls (search returns a single
  // bounded page). The provider clears the search term when the drawer closes.
  useInfiniteScroll(viewportRef, canLoadMore, loadMore)

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open)
      if (!open) {
        setEditingId(null)
        setEditTitle("")
        setDeletingId(null)
      }
    },
    [setIsOpen]
  )

  const handleEdit = useCallback((chat: Chats) => {
    setEditingId(chat.id)
    setEditTitle(chat.title || "")
  }, [])

  const handleSaveEdit = useCallback(
    async (id: string) => {
      setEditingId(null)
      await onSaveEdit(id, editTitle)
    },
    [editTitle, onSaveEdit]
  )

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
    setEditTitle("")
  }, [])

  const handleDelete = useCallback((id: string) => {
    setDeletingId(id)
  }, [])

  const handleConfirmDelete = useCallback(
    async (id: string) => {
      setDeletingId(null)
      await onConfirmDelete(id)
    },
    [onConfirmDelete]
  )

  const handleCancelDelete = useCallback(() => {
    setDeletingId(null)
  }, [])

  const renderChatItem = useCallback(
    (chat: Chats) => (
      <div key={chat.id}>
        <div className="space-y-1.5">
          {editingId === chat.id ? (
            <div className="bg-interactive-selected flex items-center justify-between rounded-lg px-2 py-2.5">
              <form
                className="flex w-full items-center justify-between"
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSaveEdit(chat.id)
                }}
              >
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="h-8 flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleSaveEdit(chat.id)
                    }
                  }}
                />
                <div className="ml-2 flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    type="submit"
                  >
                    <Icon icon={RiCheckLine} slotSize={16} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    type="button"
                    onClick={handleCancelEdit}
                  >
                    <Icon icon={RiCloseLine} slotSize={16} />
                  </Button>
                </div>
              </form>
            </div>
          ) : deletingId === chat.id ? (
            <div className="bg-interactive-selected flex items-center justify-between rounded-lg px-2 py-2.5">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleConfirmDelete(chat.id)
                }}
                className="flex w-full items-center justify-between"
              >
                <div className="flex flex-1 items-center">
                  <span className="text-base font-normal">{chat.title}</span>
                  <input
                    type="text"
                    className="sr-only"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault()
                        handleCancelDelete()
                      } else if (e.key === "Enter") {
                        e.preventDefault()
                        handleConfirmDelete(chat.id)
                      }
                    }}
                  />
                </div>
                <div className="ml-2 flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive size-8"
                    type="submit"
                  >
                    <Icon icon={RiCheckLine} slotSize={16} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive size-8"
                    onClick={handleCancelDelete}
                    type="button"
                  >
                    <Icon icon={RiCloseLine} slotSize={16} />
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            <div
              className="group flex items-center justify-between rounded-lg px-2 py-1.5"
              onClick={() => {
                if (currentChatId === chat.id) {
                  handleOpenChange(false)
                }
              }}
            >
              <Link
                href={`/c/${chat.id}`}
                key={chat.id}
                className="flex flex-1 flex-col items-start"
                prefetch
              >
                <span className="line-clamp-1 text-base font-normal">
                  {chat.title || "Untitled Chat"}
                </span>
                <span className="mr-2 text-xs font-normal text-gray-500">
                  {formatDate(chat?.updated_at || chat?.created_at)}
                </span>
              </Link>
              <div className="flex items-center">
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground size-8"
                    onClick={(e) => {
                      e.preventDefault()
                      togglePinned(chat.id, !chat.pinned)
                    }}
                    type="button"
                    aria-label={chat.pinned ? "Unpin" : "Pin"}
                  >
                    {chat.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground size-8"
                    onClick={(e) => {
                      e.preventDefault()
                      handleEdit(chat)
                    }}
                    type="button"
                  >
                    <Icon icon={RiEditLine} slotSize={16} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive size-8"
                    onClick={(e) => {
                      e.preventDefault()
                      handleDelete(chat.id)
                    }}
                    type="button"
                  >
                    <Icon icon={RiDeleteBinLine} slotSize={16} />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    ),
    [
      handleOpenChange,
      currentChatId,
      editingId,
      deletingId,
      editTitle,
      handleSaveEdit,
      handleCancelEdit,
      handleConfirmDelete,
      handleCancelDelete,
      handleEdit,
      handleDelete,
      togglePinned,
    ]
  )

  return (
    <Drawer open={isOpen} onOpenChange={handleOpenChange}>
      {trigger && (
        <Tooltip>
          <TooltipTrigger render={<DrawerTrigger render={trigger} />} />
          <TooltipContent>History</TooltipContent>
        </Tooltip>
      )}
      <DrawerContent>
        <div className="flex h-dvh max-h-[80vh] flex-col">
          {isAuthenticated ? (
            <>
              <div className="border-b p-4 pb-3">
                <div className="relative">
                  <Input
                    placeholder="Search..."
                    className="rounded-lg py-1.5 pl-8 text-base"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <Icon
                    icon={RiSearchLine}
                    slotSize={14}
                    className="absolute top-1/2 left-2.5 -translate-y-1/2 transform text-gray-400"
                  />
                </div>
              </div>

              <ScrollArea
                className="flex-1 overflow-auto"
                viewportRef={viewportRef}
              >
                <div className="flex flex-col space-y-6 px-4 pt-4 pb-8">
                  {(
                    view.isSearching
                      ? view.results.length === 0
                      : view.pinned.length === 0 && view.groups.length === 0
                  ) ? (
                    <div className="text-muted-foreground py-4 text-center text-sm">
                      No chat history found.
                    </div>
                  ) : view.isSearching ? (
                    // When searching, display a flat list without grouping
                    <div className="space-y-2">
                      {view.results.map((chat) => renderChatItem(chat))}
                    </div>
                  ) : (
                    <>
                      {view.pinned.length > 0 && (
                        <div className="space-y-0.5">
                          <h3 className="text-muted-foreground flex items-center gap-1 pl-2 text-sm font-medium">
                            <Pin size={12} className="size-3" />
                            Pinned
                          </h3>
                          <div className="space-y-2">
                            {view.pinned.map((chat) => renderChatItem(chat))}
                          </div>
                        </div>
                      )}
                      {view.groups.map((group) => (
                        <div key={group.name} className="space-y-0.5">
                          <h3 className="text-muted-foreground pl-2 text-sm font-medium">
                            {group.name}
                          </h3>
                          <div className="space-y-2">
                            {group.chats.map((chat) => renderChatItem(chat))}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </ScrollArea>
            </>
          ) : (
            <div className="flex flex-1 items-center">
              <HistoryAuthPrompt className="min-h-0 flex-1" />
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
