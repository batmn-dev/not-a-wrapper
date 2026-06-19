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
import { cn } from "@/lib/utils"
import {
  RiAddLine,
  RiAttachment2,
  RiCheckLine,
  RiGlobalLine,
} from "@remixicon/react"
import { useRef } from "react"
import { PopoverContentAuth } from "./popover-content-auth"

const composerPlusIcon = (
  <Icon icon={RiAddLine} slotSize={24} glyphInset={0} />
)

const plusTriggerClassName =
  "composer-btn size-9 min-w-9 rounded-full p-0 hover:bg-black/5 dark:hover:bg-white/10"

const authenticatedPlusTriggerClassName = cn(
  plusTriggerClassName,
  "aria-expanded:bg-black/5 dark:aria-expanded:bg-white/10"
)

const composerPlusMenuContentClassName =
  "w-[228px] min-w-[228px] overflow-hidden rounded-[16px] px-0 py-1.5"

const composerPlusMenuStyle = {
  boxShadow:
    "rgba(0, 0, 0, 0.08) 0px 8px 12px 0px, rgba(0, 0, 0, 0.62) 0px 0px 1px 0px",
}

const composerPlusMenuItemClassName =
  "mx-1.5 h-9 rounded-[10px] px-2.5 py-1.5 text-sm leading-5 hover:bg-black/5 focus:bg-black/5 data-[highlighted]:bg-black/5 dark:hover:bg-white/10 dark:focus:bg-white/10 dark:data-[highlighted]:bg-white/10"

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
                    size="icon"
                    variant="ghost"
                    className={plusTriggerClassName}
                    type="button"
                    id="composer-plus-btn"
                    data-testid="composer-plus-btn"
                    aria-label="Add files and more"
                  />
                }
              />
            }
          >
            {composerPlusIcon}
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
                    size="icon"
                    variant="ghost"
                    className={authenticatedPlusTriggerClassName}
                    type="button"
                    id="composer-plus-btn"
                    data-testid="composer-plus-btn"
                    aria-label="Add files and more"
                  />
                }
              />
            }
          >
            {composerPlusIcon}
          </TooltipTrigger>
          <TooltipContent side="bottom" hideArrow>
            More options
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          side="top"
          align="start"
          animated={false}
          className={composerPlusMenuContentClassName}
          style={composerPlusMenuStyle}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuItem
                  aria-disabled={!isFileUploadAvailable || undefined}
                  className={cn(
                    composerPlusMenuItemClassName,
                    !isFileUploadAvailable && "cursor-not-allowed opacity-50"
                  )}
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
                  className={cn(
                    composerPlusMenuItemClassName,
                    isSearchDisabled && "cursor-not-allowed opacity-50"
                  )}
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
