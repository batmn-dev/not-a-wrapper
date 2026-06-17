"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { Icon } from "@/components/ui/icon"
import { useSidebar } from "@/components/ui/sidebar"
import useClickOutside from "@/hooks/useClickOutside"
import { useChats } from "@/lib/chat-store/chats/provider"
import { Chat } from "@/lib/chat-store/types"
import { cn } from "@/lib/utils"
import { RiChat3Line, RiCheckLine, RiCloseLine } from "@remixicon/react"
import Link from "next/link"
import { useCallback, useMemo, useRef, useState } from "react"
import { SidebarItemMenu } from "./sidebar-item-menu"

type ProjectChatItemProps = {
  chat: Chat
  formatDate: (dateString: string) => string
}

export function ProjectChatItem({ chat, formatDate }: ProjectChatItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(chat.title || "")
  const [prevChatTitle, setPrevChatTitle] = useState(chat.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const { updateTitle } = useChats()
  const { setOpenMobile } = useSidebar()
  const isMobile = useBreakpoint(768)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // React 19 pattern: sync during render instead of useEffect
  if (!isEditing && chat.title !== prevChatTitle) {
    setPrevChatTitle(chat.title)
    setEditTitle(chat.title || "")
  }

  const handleStartEditing = useCallback(() => {
    setIsEditing(true)
    setEditTitle(chat.title || "")

    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    })
  }, [chat.title])

  const handleSave = useCallback(async () => {
    setIsEditing(false)
    await updateTitle(chat.id, editTitle)
  }, [chat.id, editTitle, updateTitle])

  const handleCancel = useCallback(() => {
    setEditTitle(chat.title || "")
    setIsEditing(false)
  }, [chat.title])

  const handleClickOutside = useCallback(() => {
    if (isEditing) {
      handleSave()
    }
  }, [isEditing, handleSave])

  useClickOutside(containerRef, handleClickOutside)

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setEditTitle(e.target.value)
    },
    []
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        handleSave()
      } else if (e.key === "Escape") {
        e.preventDefault()
        handleCancel()
      }
    },
    [handleSave, handleCancel]
  )

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) {
        e.stopPropagation()
      }
    },
    [isEditing]
  )

  const handleSaveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleSave()
    },
    [handleSave]
  )

  const handleCancelClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleCancel()
    },
    [handleCancel]
  )

  const handleLinkClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isMobile) setOpenMobile(false)
    },
    [isMobile, setOpenMobile]
  )

  // Memoize computed values
  const displayTitle = useMemo(
    () => chat.title || "Untitled Chat",
    [chat.title]
  )

  const containerClassName = useMemo(
    () =>
      cn(
        "sidebar-row sidebar-row-card border-border hover:bg-accent/50 group/chat relative flex items-start rounded-lg border",
        isEditing ? "bg-accent/50" : ""
      ),
    [isEditing]
  )

  if (isEditing) {
    return (
      <div
        className={containerClassName}
        onClick={handleContainerClick}
        ref={containerRef}
      >
        <div className="flex w-full items-center p-3">
          <Icon
            icon={RiChat3Line}
            slotSize={16}
            className="text-muted-foreground mr-3 flex-shrink-0"
          />
          <input
            ref={inputRef}
            value={editTitle}
            onChange={handleInputChange}
            className="text-primary flex-1 bg-transparent text-base font-medium focus:outline-none"
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <div className="ml-2 flex gap-1">
            <button
              onClick={handleSaveClick}
              className="hover:bg-secondary text-muted-foreground hover:text-primary flex size-6 items-center justify-center rounded-lg p-1"
              type="button"
            >
              <Icon icon={RiCheckLine} slotSize={12} />
            </button>
            <button
              onClick={handleCancelClick}
              className="hover:bg-secondary text-muted-foreground hover:text-primary flex size-6 items-center justify-center rounded-lg p-1"
              type="button"
            >
              <Icon icon={RiCloseLine} slotSize={12} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={containerClassName}
      onClick={handleContainerClick}
      ref={containerRef}
    >
      <Link
        href={`/c/${chat.id}`}
        className="focus-visible:ring-ring block min-w-0 grow rounded-lg p-3 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        onClick={handleLinkClick}
        prefetch
        draggable={false}
        title={displayTitle}
      >
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-medium text-balance">
              {displayTitle}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {chat.updated_at
                ? formatDate(chat.updated_at)
                : chat.created_at
                  ? formatDate(chat.created_at)
                  : null}
            </p>
          </div>
        </div>
      </Link>

      <div
        className="sidebar-row-action sidebar-row-trailing flex shrink-0 items-center justify-center pt-3 pr-3"
        key={chat.id}
      >
        <SidebarItemMenu
          chat={chat}
          onStartEditing={handleStartEditing}
          triggerAriaLabel={`Open chat actions for ${displayTitle}`}
        />
      </div>
    </div>
  )
}
