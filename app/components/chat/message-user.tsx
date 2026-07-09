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
  MessageActions,
  Message as MessageContainer,
  MessageContent,
  messageFooterRevealClassName,
} from "@/components/ui/message"
import { useScrollRoot } from "@/components/ui/scroll-root"
import type { MessageBranchInfo } from "@/lib/chat-messages/branch"
import type { EditTurnResult } from "@/lib/chat-turn/chat-turn-controller"
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
import { MessageActionButton } from "./message-action-button"
import { MessageBranchControls } from "./message-branch-controls"

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
  branch?: MessageBranchInfo
  onSelectBranch?: (messageId: string) => void
  onEdit?: (
    id: string,
    newText: string
  ) => Promise<EditTurnResult | void> | EditTurnResult | void
  isDurableChat?: boolean
}

export function MessageUser({
  attachments,
  children,
  copied,
  copyToClipboard,
  id,
  className,
  branch,
  onSelectBranch,
  onEdit,
  isDurableChat,
}: MessageUserProps) {
  const [editInput, setEditInput] = useState(children)
  const [isEditing, setIsEditing] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const savedScrollTopRef = useRef<number | null>(null)
  // Bubble width captured at edit start — the editor keeps the bubble's
  // footprint. Must be read BEFORE the isEditing flip: MessageContent unmounts
  // with it, so reading offsetWidth at render time always yields null.
  const editWidthRef = useRef<number | null>(null)
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
    editWidthRef.current = contentRef.current?.offsetWidth ?? null
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

  return (
    <MessageContainer
      as="div"
      className={cn("flex min-h-8 w-full flex-col items-end gap-1", className)}
      data-turn="user"
      data-message-id={id}
      data-message-author-role="user"
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
          className="bg-accent relative flex w-full max-w-full min-w-[180px] flex-col gap-2 rounded-[18px] px-4 py-2.5"
          style={{
            width: editWidthRef.current ?? undefined,
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
          className="bg-accent relative max-w-[var(--user-chat-width,70%)] rounded-[18px] px-4 py-2.5 leading-6 whitespace-pre-wrap"
          ref={contentRef}
        >
          {children}
        </MessageContent>
      )}
      <MessageActions className="flex gap-0">
        {/* Hover/focus reveal shared with the assistant footer so both surfaces
            behave identically (see messageFooterRevealClassName). Scoped to
            copy/edit only: the branch nav must stay visible without hover, or a
            fresh regenerate/edit gives no cue that versions now exist. */}
        <div className={cn("flex gap-0", messageFooterRevealClassName)}>
          <MessageActionButton
            label="Copy text"
            tooltip={copied ? "Copied!" : "Copy text"}
            onClick={copyToClipboard}
            icon={
              copied ? (
                <Icon icon={RiCheckLine} slotSize={20} />
              ) : (
                <Icon icon={RiFileCopyLine} slotSize={20} />
              )
            }
          />
          {isDurableChat && (
            <MessageActionButton
              label={isEditing ? "Cancel edit" : "Edit message"}
              delay={0}
              onClick={isEditing ? handleEditCancel : handleEditStart}
              icon={
                isEditing ? (
                  <Icon icon={RiPencilLine} slotSize={20} />
                ) : (
                  <Icon icon={RiEditLine} slotSize={20} />
                )
              }
            />
          )}
        </div>
        {/* Branch nav trails the copy/edit actions on user messages, matching
            ChatGPT (the right-aligned user toolbar reads copy · edit · < n/m >).
            On assistant messages it leads instead — see message-assistant.tsx. */}
        <MessageBranchControls
          branch={branch}
          onSelectBranch={onSelectBranch}
        />
      </MessageActions>
    </MessageContainer>
  )
}
