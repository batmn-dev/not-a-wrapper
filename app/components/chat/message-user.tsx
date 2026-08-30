"use client"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import {
  MessageActions,
  MessageContent,
  userMessageFooterRevealClassName,
} from "@/components/ui/message"
import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogImage,
  MorphingDialogTrigger,
} from "@/components/ui/morphing-dialog"
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
    <div className="border-border-subtle bg-background text-foreground hover:bg-interactive-hover mb-1 flex w-64 max-w-[min(16rem,calc(100vw-3rem))] items-center gap-3 rounded-md border px-3 py-2 text-left transition">
      <span className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
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
  // Bubble width captured at edit start — the editor keeps the bubble's
  // footprint. Must be read BEFORE the isEditing flip: MessageContent unmounts
  // with it, so reading offsetWidth at render time always yields null.
  const editWidthRef = useRef<number | null>(null)

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

  // Focus the textarea when entering edit mode. No scroll handling: native
  // scroll anchoring absorbs the bubble→editor swap, and focus is told not to
  // scroll.
  useEffect(() => {
    if (!isEditing) return
    textareaRef.current?.focus({ preventScroll: true })
  }, [isEditing])

  return (
    <>
      {/* Captured turn anatomy (box-chain verified 2026-07-11): a gap-4 content
          wrapper groups the `text-message` block(s); the action row is a
          ZERO-GAP column-level sibling, so the buttons sit p-1 (4px) under
          the bubble. */}
      <div className={cn("flex max-w-full grow flex-col gap-4", className)}>
        <div
          className="text-message relative flex min-h-8 w-full flex-col items-end gap-2 text-start break-words whitespace-normal"
          data-message-id={id}
          data-message-author-role="user"
          dir="auto"
        >
          <div className="flex w-full flex-col items-end gap-1 empty:hidden">
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
                className="bg-user-message relative flex w-full max-w-full min-w-[180px] flex-col gap-2 rounded-[18px] px-4 py-2.5"
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
                className="bg-user-message relative max-w-[var(--user-chat-width,70%)] min-w-0 overflow-hidden rounded-[22px] px-4 py-2.5 leading-6"
                ref={contentRef}
              >
                <div className="max-w-full min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">
                  {children}
                </div>
              </MessageContent>
            )}
          </div>
        </div>
      </div>
      {/* Every sent-message control belongs to one composable action family:
          it shares the same reveal behavior and button primitive. */}
      <div className="z-0 flex justify-end">
        <MessageActions
          className={cn(
            "-ms-2.5 -me-1 flex-wrap items-center gap-0 gap-y-4 p-1 select-none",
            userMessageFooterRevealClassName
          )}
          aria-label="Your message actions"
          role="group"
          tabIndex={-1}
        >
          <MessageActionButton
            label="Copy message"
            tooltip={copied ? "Copied!" : "Copy Message"}
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
          {/* Branch nav reveals with the footer actions to match the captured
            reference (2026-07-11). This supersedes the earlier
            always-visible rule ("a fresh regenerate/edit gives no cue that
            versions exist"): the reference hides the pager at rest too, and
            the row's hover reveal is the discovery affordance. */}
          <MessageBranchControls
            branch={branch}
            onSelectBranch={onSelectBranch}
          />
        </MessageActions>
      </div>
    </>
  )
}
