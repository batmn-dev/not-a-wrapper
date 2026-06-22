"use client"

import type { Chats } from "@/lib/chat-store/types"
import { cn } from "@/lib/utils"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import {
  RiAddLine,
  RiChat3Line,
  RiCloseLargeLine,
  RiSearchLine,
} from "@remixicon/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react"
import { HistoryAuthPrompt } from "./history-auth-prompt"
import { buildChatHistoryView, type ChatGroup } from "./utils"

type DesktopSearchModalProps = {
  chatHistory: Chats[]
  currentChatId?: string | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  isAuthenticated: boolean
}

type FlatRow =
  | {
      type: "new-chat"
      key: string
      href: "/"
    }
  | {
      type: "chat"
      key: string
      href: string
      chat: Chats
    }

const listboxId = "desktop-search-modal-listbox"

function getRowId(index: number) {
  return `desktop-search-modal-row-${index}`
}

function getChatTitle(chat: Chats) {
  return chat.title || "Untitled Chat"
}

export function DesktopSearchModal({
  chatHistory,
  currentChatId,
  isOpen,
  onOpenChange,
  isAuthenticated,
}: DesktopSearchModalProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)

  // Single shared derivation: project chats are hidden while browsing but
  // reachable by search (see buildChatHistoryView).
  const view = useMemo(
    () => buildChatHistoryView(chatHistory, query),
    [chatHistory, query]
  )

  const visibleGroups = useMemo<ChatGroup[]>(() => {
    if (view.isSearching) {
      return view.results.length
        ? [{ name: "Search results", chats: view.results }]
        : []
    }

    const groups: ChatGroup[] = []

    if (view.pinned.length > 0) {
      groups.push({ name: "Pinned", chats: view.pinned })
    }

    groups.push(...view.groups)
    return groups
  }, [view])

  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = []

    if (!view.isSearching) {
      rows.push({ type: "new-chat", key: "new-chat", href: "/" })
    }

    for (const group of visibleGroups) {
      for (const chat of group.chats) {
        rows.push({
          type: "chat",
          key: chat.id,
          href: `/c/${chat.id}`,
          chat,
        })
      }
    }

    return rows
  }, [view.isSearching, visibleGroups])

  const clampedActiveIndex =
    flatRows.length === 0 ? 0 : Math.min(activeIndex, flatRows.length - 1)
  const activeRow = flatRows[clampedActiveIndex]

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setQuery("")
        setActiveIndex(0)
      }

      onOpenChange(open)
    },
    [onOpenChange]
  )

  const selectRow = useCallback(
    (row: FlatRow | undefined) => {
      if (!row) return

      handleOpenChange(false)

      if (row.type === "chat" && row.chat.id === currentChatId) {
        return
      }

      router.push(row.href)
    },
    [currentChatId, handleOpenChange, router]
  )

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (flatRows.length === 0) return

      if (event.key === "ArrowDown") {
        event.preventDefault()
        setActiveIndex(Math.min(clampedActiveIndex + 1, flatRows.length - 1))
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        setActiveIndex(Math.max(clampedActiveIndex - 1, 0))
      } else if (event.key === "Home") {
        event.preventDefault()
        setActiveIndex(0)
      } else if (event.key === "End") {
        event.preventDefault()
        setActiveIndex(flatRows.length - 1)
      } else if (event.key === "Enter") {
        event.preventDefault()
        selectRow(activeRow)
      }
    },
    [activeRow, clampedActiveIndex, flatRows.length, selectRow]
  )

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || flatRows.length === 0) return

    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-row-index="${clampedActiveIndex}"]`
    )
    row?.scrollIntoView({ block: "nearest" })
  }, [clampedActiveIndex, flatRows.length, isOpen])

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 z-50"
          onClick={() => handleOpenChange(false)}
        />
        <DialogPrimitive.Popup
          className={cn(
            "pointer-events-none fixed inset-0 z-50 outline-none",
            "grid grid-cols-[10px_1fr_10px] grid-rows-[minmax(10px,1fr)_auto_minmax(10px,1fr)]",
            "md:grid-rows-[minmax(20px,1fr)_auto_minmax(20px,1fr)]"
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {isAuthenticated ? "Search chats" : "Log in to search chats"}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {isAuthenticated
              ? "Search your saved chat history."
              : "Saved chat history is available after you log in or create an account."}
          </DialogPrimitive.Description>

          {isAuthenticated ? (
            <div
              className={cn(
                "pointer-events-auto col-start-2 row-start-2 mx-auto flex h-[440px] w-full flex-col overflow-hidden rounded-2xl",
                "bg-popover bg-clip-padding text-popover-foreground shadow-border-xl",
                "max-w-md md:min-w-[680px] md:max-w-[680px]"
              )}
            >
              <div className="me-4 flex h-16 shrink-0 items-center justify-between">
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setActiveIndex(0)
                  }}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Search chats..."
                  aria-label="Search chats"
                  aria-controls={listboxId}
                  aria-activedescendant={
                    activeRow ? getRowId(clampedActiveIndex) : undefined
                  }
                  aria-autocomplete="list"
                  aria-expanded={isOpen}
                  role="combobox"
                  className={cn(
                    "h-full w-full border-none bg-transparent ps-5 text-base text-foreground",
                    "placeholder:text-muted-foreground focus:outline-none focus:ring-0"
                  )}
                />
                <DialogPrimitive.Close
                  aria-label="Close"
                  className={cn(
                    "ms-4 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent",
                    "text-muted-foreground hover:bg-accent hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  )}
                >
                  <RiCloseLargeLine className="size-5" aria-hidden="true" />
                </DialogPrimitive.Close>
              </div>

              <hr className="border-border" />

              <div className="my-2 min-h-0 grow overflow-y-auto">
                <div
                  ref={listRef}
                  id={listboxId}
                  role="listbox"
                  aria-label="Chats"
                  className="mx-2"
                >
                  {!view.isSearching && (
                    <SearchRow
                      id={getRowId(0)}
                      index={0}
                      active={clampedActiveIndex === 0}
                      href="/"
                      label="New chat"
                      icon={
                        <RiAddLine className="size-5 shrink-0" aria-hidden />
                      }
                      onClick={() => handleOpenChange(false)}
                      onMouseEnter={() => setActiveIndex(0)}
                    />
                  )}

                  {visibleGroups.map((group) => (
                    <div key={group.name}>
                      <div
                        className="relative my-2 px-4 pt-2 text-xs leading-4 text-muted-foreground"
                        aria-hidden="true"
                      >
                        {group.name}
                      </div>
                      {group.chats.map((chat) => {
                        const index = flatRows.findIndex(
                          (row) => row.type === "chat" && row.chat.id === chat.id
                        )

                        return (
                          <SearchRow
                            key={chat.id}
                            id={getRowId(index)}
                            index={index}
                            active={index === clampedActiveIndex}
                            href={`/c/${chat.id}`}
                            label={getChatTitle(chat)}
                            icon={
                              <RiChat3Line
                                className="size-5 shrink-0"
                                aria-hidden
                              />
                            }
                            onClick={(event) => {
                              if (chat.id === currentChatId) {
                                event.preventDefault()
                              }

                              handleOpenChange(false)
                            }}
                            onMouseEnter={() => {
                              if (index >= 0) setActiveIndex(index)
                            }}
                          />
                        )
                      })}
                    </div>
                  ))}

                  {flatRows.length === 0 && (
                    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-muted-foreground">
                      <RiSearchLine className="size-6 opacity-60" />
                      <span className="text-sm">No chat history found.</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "pointer-events-auto col-start-2 row-start-2 mx-auto w-[calc(100vw-20px)] max-w-[388px] overflow-hidden rounded-2xl",
                "bg-background text-foreground shadow-border-xl"
              )}
            >
              <header className="flex min-h-12 items-start justify-end p-2.5 pb-0">
                <DialogPrimitive.Close
                  aria-label="Close"
                  className={cn(
                    "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent",
                    "text-muted-foreground hover:bg-accent hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  )}
                >
                  <RiCloseLargeLine className="size-5" aria-hidden="true" />
                </DialogPrimitive.Close>
              </header>
              <HistoryAuthPrompt />
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

type SearchRowProps = {
  id: string
  index: number
  active: boolean
  href: string
  label: string
  icon: ReactNode
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void
  onMouseEnter: () => void
}

function SearchRow({
  id,
  index,
  active,
  href,
  label,
  icon,
  onClick,
  onMouseEnter,
}: SearchRowProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      id={id}
      data-row-index={index}
      role="option"
      aria-selected={active}
      className="block cursor-pointer no-underline"
    >
      <div
        className={cn(
          "group relative flex items-center rounded-xl px-4 py-3 text-foreground",
          "hover:bg-accent hover:text-accent-foreground",
          active && "bg-accent text-accent-foreground"
        )}
      >
        {icon}
        <div className="relative min-w-0 grow overflow-hidden whitespace-nowrap ps-2">
          <div className="truncate text-sm">{label}</div>
        </div>
      </div>
    </Link>
  )
}
