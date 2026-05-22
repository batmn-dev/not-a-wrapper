"use client"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { Popover, PopoverTrigger } from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ACCEPTED_FILE_PICKER_TYPES } from "@/lib/file-handling"
import {
  RiAddLine,
  RiAttachment2,
  RiCheckLine,
  RiGlobalLine,
} from "@remixicon/react"
import { useRef } from "react"
import { PopoverContentAuth } from "./popover-content-auth"

type ButtonPlusMenuProps = {
  onFileUpload: (files: File[]) => void
  isUserAuthenticated: boolean
  isFileUploadAvailable: boolean
  enableSearch: boolean
  onToggleSearch: (enabled: boolean) => void
  isSearchDisabled: boolean
  /** Override the default disabled tooltip for file upload */
  fileUploadDisabledMessage?: string
  /** Override the default disabled tooltip for web search */
  searchDisabledMessage?: string
}

export function ButtonPlusMenu({
  onFileUpload,
  isUserAuthenticated,
  isFileUploadAvailable,
  enableSearch,
  onToggleSearch,
  isSearchDisabled,
  fileUploadDisabledMessage,
  searchDisabledMessage,
}: ButtonPlusMenuProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Unauthenticated: show auth popover instead of dropdown
  if (!isUserAuthenticated) {
    return (
      <Popover>
        <Tooltip disableHoverablePopup>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="size-9 rounded-full"
                    type="button"
                    aria-label="More options"
                  />
                }
              />
            }
          >
            <Icon icon={RiAddLine} slotSize={22} />
          </TooltipTrigger>
          <TooltipContent side="bottom" hideArrow>
            More options
          </TooltipContent>
        </Tooltip>
        <PopoverContentAuth />
      </Popover>
    )
  }

  return (
    <>
      {/* Hidden file input for programmatic file selection */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_PICKER_TYPES}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files?.length) {
            onFileUpload(Array.from(e.target.files))
            e.target.value = "" // allow re-selecting the same file
          }
        }}
      />
      <DropdownMenu>
        <Tooltip disableHoverablePopup>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="size-9 rounded-full"
                    type="button"
                    aria-label="More options"
                  />
                }
              />
            }
          >
            <Icon icon={RiAddLine} slotSize={22} />
          </TooltipTrigger>
          <TooltipContent side="bottom" hideArrow>
            More options
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          side="top"
          align="start"
          animated={false}
          className="w-max"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuItem
                  aria-disabled={!isFileUploadAvailable || undefined}
                  className={
                    !isFileUploadAvailable
                      ? "cursor-not-allowed opacity-50"
                      : ""
                  }
                  onClick={() => {
                    if (!isFileUploadAvailable) return
                    fileInputRef.current?.click()
                  }}
                />
              }
            >
              <Icon icon={RiAttachment2} slotSize={20} />
              Add files or photos
            </TooltipTrigger>
            {!isFileUploadAvailable && (
              <TooltipContent side="right" sideOffset={4}>
                {fileUploadDisabledMessage ??
                  "This model doesn\u2019t support file uploads"}
              </TooltipContent>
            )}
          </Tooltip>
          {/* Web search — always visible, stays open on click (toggle behavior). */}
          {/* Disabled with tooltip when model can't use tools (e.g., Perplexity). */}
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuItem
                  closeOnClick={false}
                  className={
                    isSearchDisabled ? "cursor-not-allowed opacity-50" : ""
                  }
                  onClick={() => {
                    if (isSearchDisabled) return
                    onToggleSearch(!enableSearch)
                  }}
                />
              }
            >
              <Icon icon={RiGlobalLine} slotSize={20} />
              Web search
              {!isSearchDisabled && enableSearch && (
                <Icon icon={RiCheckLine} slotSize={20} className="ml-auto" />
              )}
            </TooltipTrigger>
            {isSearchDisabled && (
              <TooltipContent side="right" sideOffset={4}>
                {searchDisabledMessage ??
                  "This model doesn\u2019t support web search"}
              </TooltipContent>
            )}
          </Tooltip>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
