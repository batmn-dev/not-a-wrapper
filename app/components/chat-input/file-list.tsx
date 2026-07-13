import { AnimatePresence, motion } from "motion/react"
import { memo, useCallback, useRef, useState } from "react"
import { FileTile } from "./file-items"
import type { PendingAttachment } from "./pending-attachment"

type FileListProps = {
  attachments: PendingAttachment[]
  lockedAttachmentIds?: ReadonlySet<string>
  onFileRemove: (attachment: PendingAttachment) => void
  onRestoreLargePaste: (attachment: PendingAttachment) => void
  onRetry: (attachment: PendingAttachment) => void
}

const NO_LOCKED_ATTACHMENTS: ReadonlySet<string> = new Set()

const TRANSITION = {
  type: "spring",
  duration: 0.2,
  bounce: 0,
} as const

export const FileList = memo(function FileList({
  attachments,
  lockedAttachmentIds = NO_LOCKED_ATTACHMENTS,
  onFileRemove,
  onRestoreLargePaste,
  onRetry,
}: FileListProps) {
  const [edges, setEdges] = useState({ left: false, right: false })
  const rowRef = useRef<HTMLDivElement | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const updateEdges = useCallback((row: HTMLDivElement) => {
    const maxScrollLeft = Math.max(0, row.scrollWidth - row.clientWidth)
    setEdges({
      left: row.scrollLeft > 1,
      right: row.scrollLeft < maxScrollLeft - 1,
    })
  }, [])
  const setRowRef = useCallback(
    (row: HTMLDivElement | null) => {
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      rowRef.current = row
      if (!row) return
      requestAnimationFrame(() => updateEdges(row))
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => updateEdges(row))
        observer.observe(row)
        resizeObserverRef.current = observer
      }
    },
    [updateEdges]
  )

  return (
    <AnimatePresence initial={false}>
      {attachments.length > 0 && (
        <motion.div
          key="files-list"
          initial={{ height: 0 }}
          animate={{ height: "auto" }}
          exit={{ height: 0 }}
          transition={TRANSITION}
          className="relative overflow-hidden"
        >
          <div
            ref={setRowRef}
            data-testid="attachment-row"
            className="no-scrollbar flex max-w-full flex-row flex-nowrap gap-2 overflow-x-auto pb-4"
            onScroll={(event) => updateEdges(event.currentTarget)}
          >
            <AnimatePresence initial={false}>
              {attachments.map((attachment, index) => (
                <motion.div
                  key={attachment.id}
                  layout="position"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={TRANSITION}
                  className="relative shrink-0"
                >
                  <FileTile
                    attachment={attachment}
                    index={index}
                    isLocked={lockedAttachmentIds.has(attachment.id)}
                    onRemove={onFileRemove}
                    onRestoreLargePaste={onRestoreLargePaste}
                    onRetry={onRetry}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {edges.left ? (
            <div
              aria-hidden="true"
              data-scroll-fade="left"
              className="from-background pointer-events-none absolute inset-y-1 left-0 z-30 w-3 bg-gradient-to-r to-transparent"
            />
          ) : null}
          {edges.right ? (
            <div
              aria-hidden="true"
              data-scroll-fade="right"
              className="from-background pointer-events-none absolute inset-y-1 right-0 z-30 w-3 bg-gradient-to-l to-transparent"
            />
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
  )
})

FileList.displayName = "FileList"
