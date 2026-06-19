"use client"

import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogImage,
  MorphingDialogTrigger,
} from "@/components/motion-primitives/morphing-dialog"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import {
  MessageAction,
  MessageActions,
  Message as MessageContainer,
  MessageContent,
} from "@/components/ui/message"
import { useScrollRoot } from "@/components/ui/scroll-root"
import { cn } from "@/lib/utils"
import {
  RiCheckLine,
  RiEditLine,
  RiFileCopyLine,
  RiFileLine,
  RiFileTextLine,
  RiPencilLine,
} from "@remixicon/react"
import Image from "next/image"
import React, { useEffect, useRef, useState } from "react"
import type { EditTurnResult } from "./chat-turn"

// Attachment type for backward compatibility with v4 format
type MessageAttachment = {
  name: string
  contentType: string
  url: string
}

function getAttachmentLabel(attachment: MessageAttachment): string {
  const extension = attachment.name.split(".").pop()
  if (extension && extension !== attachment.name) return extension.toUpperCase()
  if (attachment.contentType === "application/pdf") return "PDF"
  if (attachment.contentType.startsWith("text/")) return "TXT"
  return "FILE"
}

function AttachmentFileCard({ attachment }: { attachment: MessageAttachment }) {
  const isText = attachment.contentType.startsWith("text/")
  const icon = isText ? RiFileTextLine : RiFileLine
  const content = (
    <div className="border-border bg-background text-foreground hover:bg-accent/50 mb-1 flex w-64 max-w-[min(16rem,calc(100vw-3rem))] items-center gap-3 rounded-md border px-3 py-2 text-left transition">
      <span className="bg-accent text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
        <Icon icon={icon} slotSize={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {attachment.name || "Attachment"}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {attachment.contentType || getAttachmentLabel(attachment)}
        </span>
      </span>
      <span className="text-muted-foreground shrink-0 text-xs font-medium">
        {getAttachmentLabel(attachment)}
      </span>
    </div>
  )

  if (!attachment.url) return content

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open attachment ${attachment.name || "file"}`}
    >
      {content}
    </a>
  )
}

export type MessageUserProps = {
  attachments?: MessageAttachment[]
  children: string
  copied: boolean
  copyToClipboard: () => void
  id: string
  className?: string
  onReload?: (messageId: string) => void
  onEdit?: (
    id: string,
    newText: string
  ) => Promise<EditTurnResult | void> | EditTurnResult | void
  isUserAuthenticated?: boolean
}

export function MessageUser({
  attachments,
  children,
  copied,
  copyToClipboard,
  id,
  className,
  onEdit,
  isUserAuthenticated,
}: MessageUserProps) {
  const [editInput, setEditInput] = useState(children)
  const [isEditing, setIsEditing] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const savedScrollTopRef = useRef<number | null>(null)
  const { stopScroll, scrollRef } = useScrollRoot()

  const handleEditCancel = () => {
    setIsEditing(false)
    setEditInput(children)
    setEditError(null)
    setIsSavingEdit(false)
  }

  const handleSave = async () => {
    if (isSavingEdit) return
    if (!editInput.trim()) return
    if (!onEdit) {
      setEditError("Editing is not available for this message.")
      return
    }

    setIsSavingEdit(true)
    setEditError(null)
    try {
      const result = await onEdit(id, editInput)
      if (result && !result.ok) {
        setEditError(result.message || "The edit was not submitted.")
        return
      }
      setIsEditing(false)
    } catch {
      setEditError("Failed to submit the edit. Please try again.")
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleEditStart = () => {
    savedScrollTopRef.current = scrollRef.current?.scrollTop ?? null
    setIsEditing(true)
    setEditInput(children)
    setEditError(null)
  }

  // Auto-resize textarea on content change
  useEffect(() => {
    if (!isEditing) return
    const editTextarea = textareaRef.current
    if (!editTextarea) return
    editTextarea.style.height = "auto"
    editTextarea.style.height = `${editTextarea.scrollHeight}px`
  }, [editInput, isEditing])

  // Focus textarea and preserve scroll position when entering edit mode
  useEffect(() => {
    if (!isEditing) return
    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true })
      stopScroll()
      const scrollEl = scrollRef.current
      if (scrollEl && savedScrollTopRef.current !== null) {
        scrollEl.scrollTop = savedScrollTopRef.current
        savedScrollTopRef.current = null
      }
    })
  }, [isEditing, stopScroll, scrollRef])

  const isMultiline = children.includes("\n")

  return (
    <MessageContainer
      className={cn("flex w-full flex-col items-end gap-0.5", className)}
      data-turn="user"
      data-message-id={id}
      data-scroll-anchor="false"
      tabIndex={-1}
    >
      <h5 className="sr-only">You said:</h5>
      {attachments?.map((attachment, index) => (
        <div
          className="flex flex-row gap-2"
          key={`${attachment.name}-${index}`}
        >
          {attachment.contentType?.startsWith("image") ? (
            <MorphingDialog
              transition={{
                type: "spring",
                stiffness: 280,
                damping: 18,
                mass: 0.3,
              }}
            >
              <MorphingDialogTrigger className="z-10">
                <Image
                  className="mb-1 w-40 rounded-md"
                  key={attachment.name}
                  src={attachment.url}
                  alt={attachment.name || "Attachment"}
                  width={160}
                  height={120}
                />
              </MorphingDialogTrigger>
              <MorphingDialogContainer>
                <MorphingDialogContent className="relative rounded-lg">
                  <MorphingDialogImage
                    src={attachment.url}
                    alt={attachment.name || ""}
                    className="max-h-[90vh] max-w-[90vw] object-contain"
                  />
                </MorphingDialogContent>
                <MorphingDialogClose className="text-primary" />
              </MorphingDialogContainer>
            </MorphingDialog>
          ) : (
            <AttachmentFileCard attachment={attachment} />
          )}
        </div>
      ))}
      {isEditing ? (
        <div
          className="bg-accent relative flex w-full max-w-xl min-w-[180px] flex-col gap-2 rounded-[18px] px-4 py-2"
          // TODO: contentRef.current is null here — MessageContent unmounts
          // when isEditing flips, so offsetWidth always reads null. Consider
          // capturing the width into a ref inside handleEditStart (before
          // setIsEditing) and reading that ref here instead.
          style={{
            width: contentRef.current?.offsetWidth,
          }}
        >
          <textarea
            ref={textareaRef}
            className="w-full resize-none bg-transparent outline-none"
            value={editInput}
            onChange={(e) => {
              setEditInput(e.target.value)
              if (editError) setEditError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSave()
              }
              if (e.key === "Escape") {
                handleEditCancel()
              }
            }}
            style={{
              maxHeight: "50vh",
              overflowY: "auto",
            }}
            disabled={isSavingEdit}
          />
          {editError && (
            <p className="text-destructive text-sm" role="alert">
              {editError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleEditCancel}
              disabled={isSavingEdit}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSavingEdit || !editInput.trim()}
            >
              Send
            </Button>
          </div>
        </div>
      ) : (
        <MessageContent
          className={cn(
            "bg-accent relative max-w-[var(--user-chat-width,70%)] rounded-[18px] px-4 whitespace-pre-wrap",
            isMultiline ? "py-3" : "py-1.5"
          )}
          ref={contentRef}
        >
          {children}
        </MessageContent>
      )}
      <MessageActions className="invisible flex gap-0 opacity-0 transition-opacity group-hover/turn-messages:visible group-hover/turn-messages:opacity-100 pointer-coarse:visible pointer-coarse:opacity-100">
        <MessageAction tooltip={copied ? "Copied!" : "Copy text"} side="bottom">
          <button
            className="hover:bg-accent/60 text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center rounded-lg bg-transparent transition pointer-coarse:h-10 pointer-coarse:w-10"
            aria-label="Copy text"
            onClick={copyToClipboard}
            type="button"
          >
            {copied ? (
              <Icon icon={RiCheckLine} slotSize={20} />
            ) : (
              <Icon icon={RiFileCopyLine} slotSize={20} />
            )}
          </button>
        </MessageAction>
        {isUserAuthenticated && (
          <MessageAction
            tooltip={isEditing ? "Cancel edit" : "Edit message"}
            side="bottom"
            delay={0}
          >
            <button
              className="hover:bg-accent/60 text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center rounded-lg bg-transparent transition pointer-coarse:h-10 pointer-coarse:w-10"
              aria-label={isEditing ? "Cancel edit" : "Edit message"}
              onClick={isEditing ? handleEditCancel : handleEditStart}
              type="button"
            >
              {isEditing ? (
                <Icon icon={RiPencilLine} slotSize={20} />
              ) : (
                <Icon icon={RiEditLine} slotSize={20} />
              )}
            </button>
          </MessageAction>
        )}
      </MessageActions>
    </MessageContainer>
  )
}
