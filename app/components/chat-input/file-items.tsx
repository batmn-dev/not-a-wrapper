"use client"

import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  RiArrowRightSLine,
  RiCloseLine,
  RiFileLine,
  RiFileTextLine,
  RiRefreshLine,
} from "@remixicon/react"
import Image from "next/image"
import { useRef, useState, type Ref } from "react"
import {
  getPendingAttachmentLabel,
  getPendingAttachmentVariant,
  type PendingAttachment,
  type PendingAttachmentStatus,
} from "./pending-attachment"

type FileTileSurfaceProps = {
  variant: "generated-text" | "document" | "image"
  status: PendingAttachmentStatus
  progress?: number
  error?: string
  label: string
  index: number
  previewUrl?: string
  documentType?: string
  primaryAction?: { label: string; onClick: () => void }
  primaryActionRef?: Ref<HTMLButtonElement>
  secondaryAction?: { label: string; onClick: () => void }
  isLocked?: boolean
  onRemove: () => void
  onRetry?: () => void
}

/**
 * Visual-only attachment primitive. Upload, restoration, retry, and cleanup
 * decisions stay with Composer; this component renders state and emits actions.
 */
function FileTileSurface({
  variant,
  status,
  progress,
  error,
  label,
  index,
  previewUrl,
  documentType,
  primaryAction,
  primaryActionRef,
  secondaryAction,
  isLocked = false,
  onRemove,
  onRetry,
}: FileTileSurfaceProps) {
  const isImage = variant === "image"
  const isGeneratedText = variant === "generated-text"
  const isPdf = documentType === "PDF"

  return (
    <div
      role="group"
      aria-label={label}
      data-attachment-tile={variant}
      data-attachment-status={status}
      className={cn(
        "group/attachment relative h-[58px] shrink-0 text-sm leading-5",
        isImage ? "w-14" : "w-60 md:w-80"
      )}
    >
      {primaryAction ? (
        <button
          ref={primaryActionRef}
          type="button"
          className={cn(
            "border-border-default focus-visible:ring-focus-ring absolute inset-0 z-0 rounded-[12px] border focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
            isImage
              ? "overflow-hidden transition-[filter] hover:brightness-105 focus-visible:brightness-95 active:brightness-95"
              : "hover:bg-interactive-hover active:bg-interactive-pressed transition-colors",
            status === "failed" && "border-destructive/60 bg-destructive/5"
          )}
          onClick={primaryAction.onClick}
          aria-label={primaryAction.label}
        />
      ) : (
        <div
          aria-hidden="true"
          className={cn(
            "border-border-default absolute inset-0 z-0 rounded-[12px] border",
            isImage && "overflow-hidden",
            status === "failed" && "border-destructive/60 bg-destructive/5"
          )}
        />
      )}

      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative z-10 h-full",
          !isImage && "flex min-w-0 items-center gap-2 p-2"
        )}
      >
        {isImage ? (
          previewUrl ? (
            <Image
              src={previewUrl}
              alt=""
              fill
              unoptimized
              sizes="56px"
              className="object-cover"
            />
          ) : null
        ) : (
          <>
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-[8px] text-white",
                isGeneratedText
                  ? "bg-info"
                  : isPdf
                    ? "bg-destructive"
                    : "bg-[var(--text-tertiary)]"
              )}
            >
              {status === "uploading" ? (
                progress === undefined ? (
                  <Spinner
                    slotSize={24}
                    className="text-white"
                    aria-label={`Uploading ${label}`}
                  />
                ) : (
                  <span
                    role="progressbar"
                    aria-label={`Uploading ${label}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                    className="text-[11px] font-semibold"
                  >
                    {progress}%
                  </span>
                )
              ) : (
                <Icon
                  icon={isGeneratedText ? RiFileTextLine : RiFileLine}
                  slotSize={20}
                  glyphSize={20}
                />
              )}
            </div>
            <div className="min-w-0 flex-1 pr-3">
              <div className="truncate text-sm leading-5 font-semibold">
                {label}
              </div>
              <div
                className={cn(
                  "text-muted-foreground flex h-5 min-w-0 items-center text-sm leading-5",
                  status === "failed" && onRetry && "pr-12"
                )}
              >
                <span className="block min-w-0 truncate">
                  {status === "failed"
                    ? error || "Upload failed"
                    : status === "uploading"
                      ? progress === undefined
                        ? "Uploading…"
                        : `Uploading ${progress}%`
                      : documentType}
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {isImage && status === "uploading" ? (
        <div className="bg-background/85 absolute inset-x-1 bottom-1 z-20 flex h-5 items-center justify-center rounded-md">
          {progress === undefined ? (
            <Spinner slotSize={16} aria-label={`Uploading ${label}`} />
          ) : (
            <span
              role="progressbar"
              aria-label={`Uploading ${label}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="text-[10px] font-semibold"
            >
              {progress}%
            </span>
          )}
        </div>
      ) : null}

      {secondaryAction && status !== "failed" ? (
        <button
          type="button"
          className="focus-visible:ring-focus-ring absolute bottom-1.5 left-14 z-20 inline-flex h-5 max-w-[calc(100%-4.25rem)] items-center gap-0.5 rounded-md px-0.5 text-xs leading-4 text-[var(--text-tertiary)] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
          onClick={secondaryAction.onClick}
          aria-label={secondaryAction.label}
        >
          <span className="truncate">{secondaryAction.label}</span>
          <Icon icon={RiArrowRightSLine} slotSize={12} glyphSize={12} />
        </button>
      ) : null}

      {status === "failed" && onRetry ? (
        <button
          type="button"
          className={cn(
            "text-destructive focus-visible:ring-focus-ring absolute z-20 inline-flex items-center justify-center rounded-md text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none",
            isImage
              ? "bg-background/90 bottom-1 left-1 size-6"
              : "right-2 bottom-1.5 h-5 gap-1 px-0.5"
          )}
          onClick={onRetry}
          aria-label={`Retry file ${index + 1}: ${label}`}
        >
          <Icon icon={RiRefreshLine} slotSize={12} glyphSize={12} />
          {!isImage ? "Retry" : null}
        </button>
      ) : null}

      <Tooltip disableHoverablePopup>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="attachment-remove-button bg-primary text-primary-foreground focus-visible:ring-focus-ring absolute top-1.5 right-1.5 z-30 inline-flex size-4 items-center justify-center rounded-full hover:opacity-80 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLocked}
              onClick={onRemove}
              aria-label={`${isLocked ? "Sending file" : status === "uploading" ? "Cancel upload" : "Remove file"} ${index + 1}: ${label}`}
            />
          }
        >
          <Icon icon={RiCloseLine} slotSize={16} glyphSize={16} />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4} hideArrow>
          {isLocked
            ? "Sending file"
            : status === "uploading"
              ? "Cancel upload"
              : "Remove file"}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

type FileTileProps = {
  attachment: PendingAttachment
  index: number
  isLocked?: boolean
  onRemove: (attachment: PendingAttachment) => void
  onRestoreLargePaste: (attachment: PendingAttachment) => void
  onRetry: (attachment: PendingAttachment) => void
}

export function FileTile({
  attachment,
  index,
  isLocked = false,
  onRemove,
  onRestoreLargePaste,
  onRetry,
}: FileTileProps) {
  const variant = getPendingAttachmentVariant(attachment)
  const label = getPendingAttachmentLabel(attachment)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const primaryActionRef = useRef<HTMLButtonElement>(null)
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string>()
  useBrowserLayoutEffect(() => {
    if (variant !== "image") {
      setLocalPreviewUrl(undefined)
      return
    }

    const nextUrl = URL.createObjectURL(attachment.file)
    setLocalPreviewUrl(nextUrl)
    return () => {
      URL.revokeObjectURL(nextUrl)
    }
  }, [attachment.file, variant])
  const previewUrl =
    attachment.status === "ready" && attachment.uploaded
      ? attachment.uploaded.url
      : localPreviewUrl
  const documentType =
    attachment.kind === "generated-large-paste"
      ? undefined
      : attachment.file.type === "application/pdf"
        ? "PDF"
        : (attachment.file.name.split(".").pop()?.toUpperCase() ?? "FILE")
  const canPreview =
    attachment.status === "ready" &&
    (variant === "image" || documentType === "PDF") &&
    Boolean(previewUrl)
  const handlePreviewOpenChange = (open: boolean) => {
    setIsPreviewOpen(open)
    if (!open) {
      requestAnimationFrame(() => primaryActionRef.current?.focus())
    }
  }
  const primaryAction =
    attachment.kind === "generated-large-paste"
      ? isLocked
        ? undefined
        : {
            label: `Show pasted text: ${label}`,
            onClick: () => onRestoreLargePaste(attachment),
          }
      : canPreview
        ? {
            label:
              variant === "image"
                ? `Open image: ${attachment.file.name || "User uploaded image"}`
                : attachment.file.name,
            onClick: () => setIsPreviewOpen(true),
          }
        : undefined

  return (
    <div>
      <FileTileSurface
        variant={variant}
        status={attachment.status}
        progress={
          attachment.status === "uploading" ? attachment.progress : undefined
        }
        error={attachment.status === "failed" ? attachment.error : undefined}
        label={label}
        index={index}
        previewUrl={previewUrl}
        documentType={documentType}
        primaryAction={primaryAction}
        primaryActionRef={primaryActionRef}
        secondaryAction={
          attachment.kind === "generated-large-paste" && !isLocked
            ? {
                label: "Show in text field",
                onClick: () => onRestoreLargePaste(attachment),
              }
            : undefined
        }
        isLocked={isLocked}
        onRemove={() => onRemove(attachment)}
        onRetry={
          attachment.status !== "failed" || attachment.retryable
            ? () => onRetry(attachment)
            : undefined
        }
      />

      {canPreview && previewUrl ? (
        <FilePreviewModal
          open={isPreviewOpen}
          onOpenChange={handlePreviewOpenChange}
          file={attachment.file}
          previewUrl={previewUrl}
          variant={variant === "image" ? "image" : "document"}
        />
      ) : null}
    </div>
  )
}

type FilePreviewModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  file: File
  previewUrl: string
  variant: "document" | "image"
}

export function FilePreviewModal({
  open,
  onOpenChange,
  file,
  previewUrl,
  variant,
}: FilePreviewModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(90vh,900px)] max-w-[min(92vw,1100px)] flex-col gap-4 overflow-hidden p-4 sm:max-w-[min(92vw,1100px)]"
        aria-label={file.name}
        showCloseButton={false}
      >
        <DialogHeader className="min-w-0 flex-row items-center justify-between gap-3">
          <DialogTitle className="truncate text-base leading-6">
            {file.name}
          </DialogTitle>
          <DialogClose
            render={
              <button
                type="button"
                className="focus-visible:ring-focus-ring shrink-0 rounded-md px-2 py-1 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
              />
            }
          >
            Close
          </DialogClose>
        </DialogHeader>
        {variant === "image" ? (
          <div className="relative min-h-0 flex-1">
            <Image
              src={previewUrl}
              alt={file.name || "User uploaded image"}
              fill
              unoptimized
              sizes="92vw"
              className="object-contain"
            />
          </div>
        ) : (
          <iframe
            src={previewUrl}
            title={file.name}
            className="min-h-0 w-full flex-1 rounded-lg border"
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
