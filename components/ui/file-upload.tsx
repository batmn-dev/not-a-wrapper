"use client"

import { cn } from "@/lib/utils"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { createPortal } from "react-dom"

// Hydration-safe hook using useSyncExternalStore (React 19 pattern)
const subscribe = () => () => {}
const getSnapshot = () => true
const getServerSnapshot = () => false

function useHydrated() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

type FileUploadContextValue = {
  isDragging: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  openFilePicker: () => void
  multiple?: boolean
  disabled?: boolean
}

const FileUploadContext = createContext<FileUploadContextValue | null>(null)

export type FileUploadProps = {
  onFilesAdded: (files: File[]) => void
  children: React.ReactNode
  multiple?: boolean
  accept?: string
  disabled?: boolean
}

function FileUpload({
  onFilesAdded,
  children,
  multiple = true,
  accept,
  disabled = false,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  const handleFiles = useCallback(
    (files: FileList) => {
      const newFiles = Array.from(files)
      if (multiple) {
        onFilesAdded(newFiles)
      } else {
        onFilesAdded(newFiles.slice(0, 1))
      }
    },
    [multiple, onFilesAdded]
  )

  useEffect(() => {
    const handleDrag = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const handleDragIn = (e: DragEvent) => {
      handleDrag(e)
      dragCounter.current++
      if (e.dataTransfer?.items.length) setIsDragging(true)
    }

    const handleDragOut = (e: DragEvent) => {
      handleDrag(e)
      dragCounter.current--
      if (dragCounter.current === 0) setIsDragging(false)
    }

    const handleDrop = (e: DragEvent) => {
      handleDrag(e)
      setIsDragging(false)
      dragCounter.current = 0
      if (e.dataTransfer?.files.length) {
        handleFiles(e.dataTransfer.files)
      }
    }

    window.addEventListener("dragenter", handleDragIn)
    window.addEventListener("dragleave", handleDragOut)
    window.addEventListener("dragover", handleDrag)
    window.addEventListener("drop", handleDrop)

    return () => {
      window.removeEventListener("dragenter", handleDragIn)
      window.removeEventListener("dragleave", handleDragOut)
      window.removeEventListener("dragover", handleDrag)
      window.removeEventListener("drop", handleDrop)
    }
  }, [handleFiles, onFilesAdded, multiple])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      handleFiles(e.target.files)
      e.target.value = ""
    }
  }

  const openFilePicker = useCallback(() => {
    if (!disabled) inputRef.current?.click()
  }, [disabled])

  return (
    <FileUploadContext.Provider
      value={{ isDragging, inputRef, openFilePicker, multiple, disabled }}
    >
      <input
        type="file"
        ref={inputRef}
        onChange={handleFileSelect}
        className="hidden"
        multiple={multiple}
        accept={accept}
        aria-hidden
        tabIndex={-1}
        disabled={disabled}
      />
      {children}
    </FileUploadContext.Provider>
  )
}

export type FileUploadTriggerProps = useRender.ComponentProps<"button">

function FileUploadTrigger({
  className,
  render,
  ...props
}: FileUploadTriggerProps) {
  const context = useContext(FileUploadContext)

  const defaultProps: useRender.ElementProps<"button"> = {
    type: "button",
    className: cn(
      "cursor-pointer disabled:cursor-not-allowed aria-disabled:cursor-not-allowed data-disabled:cursor-not-allowed",
      className
    ),
    disabled: context?.disabled,
    onClick: (e) => {
      e.stopPropagation()
      context?.openFilePicker()
    },
  }

  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(defaultProps, props),
  })
}

function useFileUpload() {
  const context = useContext(FileUploadContext)
  if (!context) {
    throw new Error("useFileUpload must be used within FileUpload")
  }
  return context
}

type FileUploadContentProps = React.HTMLAttributes<HTMLDivElement>

function FileUploadContent({
  className,
  style,
  ...props
}: FileUploadContentProps) {
  const context = useContext(FileUploadContext)
  const mounted = useHydrated()

  if (!context?.isDragging || !mounted || context?.disabled) {
    return null
  }

  const content = (
    <div
      className={cn(
        "bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm",
        "[transform:translateY(0)_scale(1)] opacity-100",
        "starting:[transform:translateY(2.5rem)_scale(0.9)] starting:opacity-0",
        className
      )}
      style={{
        transition: "opacity 150ms ease-out, transform 150ms ease-out",
        ...style,
      }}
      {...props}
    />
  )

  return createPortal(content, document.body)
}

export { FileUpload, FileUploadTrigger, FileUploadContent, useFileUpload }
