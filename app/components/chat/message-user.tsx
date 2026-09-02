"use client"

import { AutosizeTextarea } from "@/components/ui/autosize-textarea"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import {
  MessageActions,
  userMessageFooterRevealClassName,
} from "@/components/ui/message"
import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogImage,
  MorphingDialogTitle,
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
} from "@remixicon/react"
import Image from "next/image"
import React, { useCallback, useId, useRef, useState } from "react"
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

function MessageAttachmentView({
  attachment,
}: {
  attachment: MessageAttachment
}) {
  if (!attachment.contentType?.startsWith("image")) {
    return <AttachmentFileCard attachment={attachment} />
  }

  return (
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
          src={attachment.url}
          alt={attachment.name || "Attachment"}
          width={160}
          height={120}
        />
      </MorphingDialogTrigger>
      <MorphingDialogContainer>
        <MorphingDialogContent className="relative rounded-lg">
          {/* Names the lightbox for screen readers; the content's aria-labelledby points here. */}
          <MorphingDialogTitle className="sr-only">
            Attachment preview: {attachment.name || "image"}
          </MorphingDialogTitle>
          <MorphingDialogImage
            src={attachment.url}
            alt={attachment.name || ""}
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
        </MorphingDialogContent>
        <MorphingDialogClose className="text-primary" />
      </MorphingDialogContainer>
    </MorphingDialog>
  )
}

function SharePromptIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      focusable="false"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M16.6663 10.1681C17.0335 10.1681 17.3313 10.4659 17.3313 10.8332V14.1994C17.3313 15.929 15.929 17.3312 14.1995 17.3312H5.80005C4.07048 17.3312 2.66821 15.929 2.66821 14.1994V10.8332C2.66821 10.4659 2.96598 10.1681 3.33325 10.1681C3.70052 10.1681 3.99829 10.4659 3.99829 10.8332V14.1994C3.99829 15.1944 4.80502 16.0011 5.80005 16.0011H14.1995C15.1945 16.0011 16.0012 15.1944 16.0012 14.1994V10.8332C16.0012 10.466 16.2991 10.1683 16.6663 10.1681Z" />
      <path d="M9.31763 3.08317C9.71412 2.76014 10.2865 2.75993 10.6829 3.08317L10.7649 3.15739L14.012 6.40446C14.2716 6.66406 14.2714 7.08517 14.012 7.34489C13.7523 7.60459 13.3312 7.60459 13.0715 7.34489L10.6653 4.93864V11.8752C10.6653 12.2423 10.3674 12.54 10.0002 12.5402C9.63297 12.5402 9.33521 12.2424 9.33521 11.8752V4.93669L6.92896 7.34489C6.66926 7.60459 6.24725 7.60459 5.98755 7.34489C5.72836 7.08521 5.72817 6.66402 5.98755 6.40446L9.23462 3.15739L9.31763 3.08317Z" />
    </svg>
  )
}

function CollapsibleUserMessageChevron() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4"
      fill="currentColor"
    >
      <path d="M12.629 5.879a.525.525 0 1 1 .742.742l-4.765 4.765a.86.86 0 0 1-1.212 0L2.629 6.62a.525.525 0 1 1 .742-.742L8 10.508z" />
    </svg>
  )
}

const collapsedMessageMaxHeight = 264

function CollapsibleUserMessage({ children }: { children: string }) {
  const contentId = useId()
  const [canExpand, setCanExpand] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  const setContentNode = useCallback((node: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
    if (!node) return

    const measure = () => {
      const isOverflowing = node.scrollHeight > collapsedMessageMaxHeight
      setCanExpand(isOverflowing)
      if (!isOverflowing) setIsExpanded(false)
    }

    measure()
    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(measure)
    observer.observe(node)
    resizeObserverRef.current = observer
  }, [])

  return (
    <div
      className="grid"
      data-custom-highlighting-behavior="boundary"
      data-collapsed={canExpand && !isExpanded ? "" : undefined}
      data-testid="collapsible-user-message-root"
      data-can-expand={canExpand ? "" : undefined}
    >
      <div
        id={contentId}
        ref={setContentNode}
        data-testid="collapsible-user-message-content"
        className={cn(
          canExpand &&
            !isExpanded &&
            "max-h-[264px] overflow-clip [mask-image:linear-gradient(#000_calc(100%_-_48px),transparent)]"
        )}
      >
        <div className="max-w-full min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">
          {children}
        </div>
      </div>
      {canExpand && (
        <button
          type="button"
          aria-controls={contentId}
          aria-expanded={isExpanded}
          className="text-muted-foreground mt-2 flex w-fit items-center gap-1 rounded-md py-0.5 text-sm leading-5 font-medium select-none"
          data-testid="collapsible-user-message-toggle"
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >
          <span className={cn(isExpanded && "hidden")}>Show more</span>
          <span className={cn(!isExpanded && "hidden")}>Show less</span>
          <div
            className={cn(
              "size-4 motion-safe:transition-transform motion-safe:duration-150",
              isExpanded && "rotate-180"
            )}
          >
            <CollapsibleUserMessageChevron />
          </div>
        </button>
      )}
    </div>
  )
}

function UserMessageBubble({
  children,
  containsAttachments,
}: {
  children: React.ReactNode
  containsAttachments: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start self-end rtl:items-end rtl:self-start",
        "w-fit max-w-(--user-chat-width,70%)"
      )}
    >
      <div className="contents w-full">
        <div
          className={cn(
            "corner-superellipse/0.98 user-message-bubble-color relative w-full min-w-0 overflow-hidden rounded-[22px] [background-color:var(--theme-user-msg-bg,var(--user-message-bg))] px-4 py-2.5 leading-6 [color:var(--theme-user-msg-text,var(--foreground))]",
            containsAttachments && "rounded-se-lg"
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function UserMessageEditor({
  attachments,
  editError,
  editInput,
  isSavingEdit,
  onCancel,
  onChange,
  onSave,
}: {
  attachments?: MessageAttachment[]
  editError: string | null
  editInput: string
  isSavingEdit: boolean
  onCancel: () => void
  onChange: (value: string) => void
  onSave: () => void
}) {
  const focusEditor = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return
    textarea.focus({ preventScroll: true })
    const end = textarea.value.length
    textarea.setSelectionRange(end, end)
  }, [])

  return (
    <div className="font-native bg-secondary rounded-3xl px-3 py-3">
      {attachments && attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment, index) => (
            <MessageAttachmentView
              attachment={attachment}
              key={`${attachment.name}-${index}`}
            />
          ))}
        </div>
      ) : null}
      <div
        className="m-2 max-h-[25dvh] overflow-auto"
        onCopy={(event) => event.stopPropagation()}
      >
        {/* While the edit request is in flight the editor is inert: readOnly
            keeps focus in place but drops typing, and the key handler drops
            Escape/submit so a cancel cannot race the pending completion. */}
        <AutosizeTextarea
          ref={focusEditor}
          aria-label="Edit message"
          aria-busy={isSavingEdit || undefined}
          readOnly={isSavingEdit}
          className="m-0 w-full resize-none border-0 bg-transparent focus:ring-0 focus-visible:ring-0"
          value={editInput}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (isSavingEdit || event.nativeEvent.isComposing) return
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.shiftKey
            ) {
              event.preventDefault()
              onSave()
              return
            }
            if (event.key === "Escape" && !event.defaultPrevented) {
              onCancel()
            }
          }}
        />
        {editError ? (
          <p className="text-destructive mt-2 text-sm" role="alert">
            {editError}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2 px-2 pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={isSavingEdit}
        >
          <div className="flex items-center justify-center">Cancel</div>
        </Button>
        <Button
          type="button"
          onClick={onSave}
          aria-busy={isSavingEdit || undefined}
          disabled={isSavingEdit || !editInput.trim()}
        >
          <div className="flex items-center justify-center">Send</div>
        </Button>
      </div>
    </div>
  )
}

export type MessageUserProps = {
  attachments?: MessageAttachment[]
  children: string
  copied: boolean
  copyToClipboard: () => void
  sharePrompt?: () => void
  id: string
  className?: string
  onReload?: (messageId: string) => void
  branch?: MessageBranchInfo
  onSelectBranch?: (messageId: string) => void
  onEdit?: (
    id: string,
    newText: string
  ) => Promise<EditTurnResult | void> | EditTurnResult | void
  isEditing: boolean
  onEditingChange: (isEditing: boolean) => void
  isDurableChat?: boolean
}

export function MessageUser({
  attachments,
  children,
  copied,
  copyToClipboard,
  sharePrompt,
  id,
  className,
  branch,
  onSelectBranch,
  onEdit,
  isEditing,
  onEditingChange,
  isDurableChat,
}: MessageUserProps) {
  const [editInput, setEditInput] = useState(children)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  // Each editor open/close starts a new session. A pending save captures its
  // session and only settles the editor it started from, so a completion that
  // lands after the editor was closed and reopened never discards the new draft.
  const editSessionRef = useRef(0)

  const handleEditCancel = () => {
    editSessionRef.current += 1
    onEditingChange(false)
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

    const editSession = editSessionRef.current
    setIsSavingEdit(true)
    setEditError(null)
    let failure: string | null = null
    try {
      const result = await onEdit(id, editInput)
      if (result && !result.ok) {
        failure = result.message || "The edit was not submitted."
      }
    } catch {
      failure = "Failed to submit the edit. Please try again."
    }
    if (editSession !== editSessionRef.current) return

    setIsSavingEdit(false)
    if (failure) {
      setEditError(failure)
      return
    }
    onEditingChange(false)
  }

  const handleEditStart = () => {
    editSessionRef.current += 1
    onEditingChange(true)
    setEditInput(children)
    setEditError(null)
    setIsSavingEdit(false)
  }

  if (isEditing) {
    return (
      <UserMessageEditor
        attachments={attachments}
        editError={editError}
        editInput={editInput}
        isSavingEdit={isSavingEdit}
        onCancel={handleEditCancel}
        onChange={(value) => {
          setEditInput(value)
          if (editError) setEditError(null)
        }}
        onSave={handleSave}
      />
    )
  }

  return (
    <>
      {/* Captured turn anatomy (box-chain verified 2026-07-11): a gap-4 content
          wrapper groups the `text-message` block(s); the action row is a
          ZERO-GAP column-level sibling, so the buttons sit p-1 (4px) under
          the bubble. */}
      <div className={cn("flex max-w-full grow flex-col gap-4", className)}>
        <div
          className="text-message font-native keyboard-focused:focus-ring relative flex min-h-8 w-full flex-col items-end gap-2 text-start break-words whitespace-normal outline-none [.text-message+&]:mt-1"
          data-message-id={id}
          data-message-author-role="user"
          dir="auto"
        >
          <div className="flex w-full flex-col items-end gap-1 empty:hidden rtl:items-start">
            {attachments?.map((attachment, index) => (
              <div
                className="flex flex-row gap-2"
                key={`${attachment.name}-${index}`}
              >
                <MessageAttachmentView attachment={attachment} />
              </div>
            ))}
            <UserMessageBubble
              containsAttachments={Boolean(attachments?.length)}
            >
              <CollapsibleUserMessage key={children}>
                {children}
              </CollapsibleUserMessage>
            </UserMessageBubble>
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
          {isDurableChat && sharePrompt ? (
            <MessageActionButton
              label="Share prompt"
              onClick={sharePrompt}
              icon={<SharePromptIcon />}
              testId="share-prompt-link-turn-action-button"
            />
          ) : null}
          {isDurableChat && (
            <MessageActionButton
              label="Edit message"
              onClick={handleEditStart}
              icon={<Icon icon={RiEditLine} slotSize={20} />}
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
