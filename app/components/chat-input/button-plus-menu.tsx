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
import { cn } from "@/lib/utils"
import {
  RiAddLargeLine,
  RiAttachment2,
  RiCheckLine,
  RiGlobalLine,
} from "@remixicon/react"
import { useState } from "react"
import { PopoverContentAuth } from "./popover-content-auth"

const composerPlusIcon = (
  <Icon icon={RiAddLargeLine} slotSize={20} glyphInset={0} />
)

const plusTriggerClassName =
  "composer-btn size-9 min-w-9 rounded-full p-0 hover:bg-interactive-hover active:bg-interactive-pressed"

const authenticatedPlusTriggerClassName = cn(
  plusTriggerClassName,
  "aria-expanded:bg-interactive-selected"
)

const composerPlusMenuContentClassName = "w-[228px] min-w-[228px]"

type ButtonPlusMenuProps = {
  onOpenFilePicker: () => void
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
  onOpenFilePicker,
  isUserAuthenticated,
  isFileUploadAvailable,
  enableSearch,
  onToggleSearch,
  isSearchDisabled,
  fileUploadDisabledMessage,
  searchDisabledMessage,
}: ButtonPlusMenuProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  // Unauthenticated: show auth popover instead of dropdown
  if (!isUserAuthenticated) {
    return (
      <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <Tooltip disableHoverablePopup disabled={isMenuOpen}>
          <TooltipTrigger render={<span className="inline-flex" />}>
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
            >
              {composerPlusIcon}
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" hideArrow>
            Add files and more
          </TooltipContent>
        </Tooltip>
        <PopoverContentAuth />
      </Popover>
    )
  }

  return (
    <>
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <Tooltip disableHoverablePopup disabled={isMenuOpen}>
          <TooltipTrigger render={<span className="inline-flex" />}>
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
            >
              {composerPlusIcon}
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" hideArrow>
            Add files and more
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          side="top"
          align="start"
          animated={false}
          className={composerPlusMenuContentClassName}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuItem
                  disabled={!isFileUploadAvailable}
                  onClick={onOpenFilePicker}
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
                  disabled={isSearchDisabled}
                  onClick={() => onToggleSearch(!enableSearch)}
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
