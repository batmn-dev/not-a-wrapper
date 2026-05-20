import { FileUpload, FileUploadContent } from "@/components/ui/file-upload"
import { Icon } from "@/components/ui/icon"
import { ACCEPTED_FILE_PICKER_TYPES } from "@/lib/file-handling"
import {
  RiFileTextLine,
  RiFolderFill,
  RiImageCircleFill,
} from "@remixicon/react"

type InputDropZoneProps = {
  onFileUpload: (files: File[]) => void
  disabled?: boolean
  children: React.ReactNode
}

/**
 * Shared drag-and-drop file upload zone for chat inputs.
 * Wraps prompt content with a FileUpload provider and standard drop overlay.
 */
export function InputDropZone({
  onFileUpload,
  disabled,
  children,
}: InputDropZoneProps) {
  return (
    <FileUpload
      onFilesAdded={onFileUpload}
      multiple
      accept={ACCEPTED_FILE_PICKER_TYPES}
      disabled={disabled}
    >
      {children}
      <FileUploadContent>
        <div className="border-input bg-background flex flex-col items-center rounded-lg border border-dashed p-8 text-center">
          <div className="relative mb-6 h-20 w-36" aria-hidden="true">
            <div className="absolute top-5 left-1 flex size-12 -rotate-12 items-center justify-center rounded-lg bg-green-100 text-green-700">
              <Icon icon={RiImageCircleFill} slotSize={28} />
            </div>
            <div className="absolute top-1 right-1 flex size-12 rotate-12 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
              <Icon icon={RiFileTextLine} slotSize={28} />
            </div>
            <div className="absolute top-8 left-1/2 z-10 flex size-12 -translate-x-1/2 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
              <Icon icon={RiFolderFill} slotSize={28} />
            </div>
          </div>
          <span className="mb-1 text-lg font-medium">Drop files here</span>
          <span className="text-muted-foreground text-sm">
            Drop files here to add them to the conversation
          </span>
        </div>
      </FileUploadContent>
    </FileUpload>
  )
}
