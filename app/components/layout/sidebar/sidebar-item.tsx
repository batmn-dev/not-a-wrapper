import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import useClickOutside from "@/app/hooks/use-click-outside"
import { Icon } from "@/components/ui/icon"
import { useSidebar } from "@/components/ui/sidebar"
import { useChats } from "@/lib/chat-store/chats/provider"
import { Chat } from "@/lib/chat-store/types"
import { cn } from "@/lib/utils"
import { RiCheckLine, RiCloseLine } from "@remixicon/react"
import Link from "next/link"
import { useCallback, useMemo, useRef, useState } from "react"
import { SidebarItemMenu } from "./sidebar-item-menu"

type SidebarItemProps = {
  chat: Chat
  currentChatId: string
}

export function SidebarItem({ chat, currentChatId }: SidebarItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(chat.title || "")
  const [isMenuOpen, setIsMenuOpen] = useState(false)
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
    setIsMenuOpen(false)
    await updateTitle(chat.id, editTitle)
  }, [chat.id, editTitle, updateTitle])

  const handleCancel = useCallback(() => {
    setEditTitle(chat.title || "")
    setIsEditing(false)
    setIsMenuOpen(false)
  }, [chat.title])

  const handleMenuOpenChange = useCallback((open: boolean) => {
    setIsMenuOpen(open)
  }, [])

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
  const isActive = useMemo(
    () => chat.id === currentChatId || isEditing || isMenuOpen,
    [chat.id, currentChatId, isEditing, isMenuOpen]
  )

  const displayTitle = useMemo(
    () => chat.title || "Untitled Chat",
    [chat.title]
  )

  const containerClassName = useMemo(
    () =>
      cn(
        "menu-item-hoverable hover:bg-accent/80 hover:text-foreground group/chat relative mx-1.5 h-9 w-[calc(100%-var(--spacing)*3)] rounded-lg pointer-coarse:h-auto",
        isActive && "bg-accent hover:bg-accent text-foreground"
      ),
    [isActive]
  )

  const menuClassName = useMemo(
    () =>
      cn(
        "absolute top-0 right-1 flex h-full items-center justify-center opacity-0 group-hover/chat:opacity-100",
        isMobile && "opacity-100 group-hover/chat:opacity-100"
      ),
    [isMobile]
  )

  return (
    <div
      className={containerClassName}
      onClick={handleContainerClick}
      ref={containerRef}
    >
      {isEditing ? (
        <div className="flex h-full items-center rounded-lg py-[3px] pr-1 pl-2">
          <input
            ref={inputRef}
            value={editTitle}
            onChange={handleInputChange}
            className="text-primary max-h-full w-full bg-transparent text-sm focus:outline-none"
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <div className="flex gap-0.5">
            <button
              onClick={handleSaveClick}
              className="hover:bg-secondary text-muted-foreground hover:text-primary flex size-7 items-center justify-center rounded-lg p-1"
              type="button"
            >
              <Icon icon={RiCheckLine} slotSize={16} />
            </button>
            <button
              onClick={handleCancelClick}
              className="hover:bg-secondary text-muted-foreground hover:text-primary flex size-7 items-center justify-center rounded-lg p-1"
              type="button"
            >
              <Icon icon={RiCloseLine} slotSize={16} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <Link
            href={`/c/${chat.id}`}
            className="block h-full w-full"
            prefetch
            draggable={false}
            onClick={handleLinkClick}
          >
            <div
              className="text-primary relative flex h-full w-full items-center overflow-hidden mask-r-from-80% mask-r-to-85% px-2.5 py-1.5 text-sm pointer-coarse:h-auto pointer-coarse:py-3"
              title={displayTitle}
            >
              <span className="min-w-0 truncate" dir="auto">
                {displayTitle}
              </span>
            </div>
          </Link>

          <div className={menuClassName} key={chat.id}>
            <SidebarItemMenu
              chat={chat}
              onStartEditing={handleStartEditing}
              onMenuOpenChange={handleMenuOpenChange}
            />
          </div>
        </>
      )}
    </div>
  )
}
