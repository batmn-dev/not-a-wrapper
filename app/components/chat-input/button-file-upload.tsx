import { RiAttachment2, RiUpload2Line } from "@remixicon/react"
import {
  FileUpload,
  FileUploadContent,
  FileUploadTrigger,
} from "@/components/ui/file-upload"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ACCEPTED_FILE_PICKER_TYPES } from "@/lib/file-handling"
import { getModelInfo } from "@/lib/models"
import { cn } from "@/lib/utils"
import React from "react"
import { PopoverContentAuth } from "./popover-content-auth"

type ButtonFileUploadProps = {
  onFileUpload: (files: File[]) => void
  isUserAuthenticated: boolean
  model: string
}

export function ButtonFileUpload({
  onFileUpload,
  isUserAuthenticated,
  model,
}: ButtonFileUploadProps) {
  const isFileUploadAvailable = getModelInfo(model)?.vision

  if (!isFileUploadAvailable) {
    return (
      <Popover>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    size="sm"
                    variant="secondary"
                    className="border-border dark:bg-secondary size-9 rounded-full border bg-transparent"
                    type="button"
                    aria-label="Add files"
                  />
                }
              />
            }
          >
            <RiAttachment2 size={16} />
          </TooltipTrigger>
          <TooltipContent side="bottom" hideArrow>Add files</TooltipContent>
        </Tooltip>
        <PopoverContent className="p-2">
          <div className="text-secondary-foreground text-sm">
            This model does not support file uploads.
            <br />
            Please select another model.
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  if (!isUserAuthenticated) {
    return (
      <Popover>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    size="sm"
                    variant="secondary"
                    className="border-border dark:bg-secondary size-9 rounded-full border bg-transparent"
                    type="button"
                    aria-label="Add files"
                  />
                }
              />
            }
          >
            <RiAttachment2 size={16} />
          </TooltipTrigger>
          <TooltipContent side="bottom" hideArrow>Add files</TooltipContent>
        </Tooltip>
        <PopoverContentAuth />
      </Popover>
    )
  }

  return (
    <FileUpload
      onFilesAdded={onFileUpload}
      multiple
      disabled={!isUserAuthenticated}
      accept={ACCEPTED_FILE_PICKER_TYPES}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <FileUploadTrigger
              render={
                <Button
                  size="sm"
                  variant="secondary"
                  className={cn(
                    "border-border dark:bg-secondary size-9 rounded-full border bg-transparent",
                    !isUserAuthenticated && "opacity-50"
                  )}
                  type="button"
                  disabled={!isUserAuthenticated}
                  aria-label="Add files"
                />
              }
            />
          }
        >
          <RiAttachment2 size={16} />
        </TooltipTrigger>
        <TooltipContent side="bottom" hideArrow>Add files</TooltipContent>
      </Tooltip>
      <FileUploadContent>
        <div className="border-input bg-background flex flex-col items-center rounded-lg border border-dashed p-8">
          <RiUpload2Line size={32} className="size-8 text-muted-foreground" />
          <span className="mt-4 mb-1 text-lg font-medium">Drop files here</span>
          <span className="text-muted-foreground text-sm">
            Drop files here to add them to the conversation
          </span>
        </div>
      </FileUploadContent>
    </FileUpload>
  )
}
