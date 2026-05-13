"use client"
import { RiArrowUpLine } from "@remixicon/react"

import { PromptSystem } from "@/app/components/suggestions/prompt-system"
import { ButtonPlusMenu } from "@/app/components/chat-input/button-plus-menu"
import { InputDropZone } from "@/app/components/chat-input/input-drop-zone"
import { FileList } from "@/app/components/chat-input/file-list"
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input"
import { Button } from "@/components/ui/button"
import { StopBulkRoundedIcon } from "@/lib/icons"
import { resolveComposerPrimaryActionState } from "@/app/components/chat-input/primary-action-state"
import React, { useCallback, useMemo } from "react"

type MultiChatInputProps = {
  value: string
  onValueChange: (value: string) => void
  onSuggestion: (suggestion: string) => void
  hasSuggestions?: boolean
  onSend: () => void
  isSubmitting?: boolean
  files: File[]
  onFileUpload: (files: File[]) => void
  onFileRemove: (file: File) => void
  selectedModelIds: string[]
  isUserAuthenticated: boolean
  fileUploadState: "supported" | "unsupported" | "no-selection"
  stop: () => void
  status?: "submitted" | "streaming" | "ready" | "error"
  anyLoading?: boolean
  enableSearch: boolean
  setEnableSearch: (enabled: boolean) => void
  searchSupportState: "supported" | "unsupported" | "no-selection"
}

export function MultiChatInput({
  value,
  onValueChange,
  onSuggestion,
  hasSuggestions,
  onSend,
  isSubmitting,
  selectedModelIds,
  isUserAuthenticated,
  files,
  onFileUpload,
  onFileRemove,
  fileUploadState,
  stop,
  status,
  anyLoading,
  enableSearch,
  setEnableSearch,
  searchSupportState,
}: MultiChatInputProps) {
  const isOnlyWhitespace = (text: string) => !/[^\s]/.test(text)
  const isStreaming = status === "streaming" || Boolean(anyLoading)

  const isFileUploadAvailable = fileUploadState === "supported"
  const isSearchDisabled = searchSupportState !== "supported"

  const fileUploadDisabledMessage = useMemo(() => {
    if (fileUploadState === "no-selection")
      return "Select at least one model to upload files."
    return "Some selected models don\u2019t support file uploads."
  }, [fileUploadState])

  const searchDisabledMessage = useMemo(() => {
    if (searchSupportState === "no-selection")
      return "Select at least one model to use web search."
    return "None of the selected models support web search."
  }, [searchSupportState])

  const primaryAction = resolveComposerPrimaryActionState({
    isStreaming,
    isAbortable: Boolean(anyLoading),
    canSend:
      !isSubmitting &&
      !Boolean(anyLoading) &&
      !isOnlyWhitespace(value) &&
      selectedModelIds.length > 0,
  })

  const handlePrimaryActionClick = useCallback(() => {
    if (primaryAction.disabled) {
      return
    }

    if (primaryAction.intent === "stop") {
      stop()
      return
    }

    onSend()
  }, [onSend, primaryAction.disabled, primaryAction.intent, stop])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey) {
        return
      }

      if (primaryAction.mode === "stop") {
        return
      }

      if (!primaryAction.disabled) {
        e.preventDefault()
        onSend()
      }
    },
    [onSend, primaryAction.disabled, primaryAction.mode]
  )

  return (
    <div className="relative flex w-full flex-col gap-4">
      {hasSuggestions && (
        <PromptSystem
          onValueChange={onValueChange}
          onSuggestion={onSuggestion}
          value={value}
        />
      )}
      <InputDropZone
        onFileUpload={onFileUpload}
        disabled={!isUserAuthenticated || !isFileUploadAvailable}
      >
        <div className="relative order-2 px-2 pb-3 sm:pb-4 md:order-1">
          <PromptInput
            className="bg-popover relative z-10 p-0 pt-1 shadow-xs backdrop-blur-xl"
            maxHeight={200}
            value={value}
            onValueChange={onValueChange}
          >
            <FileList files={files} onFileRemove={onFileRemove} />
            <PromptInputTextarea
              placeholder="Ask all selected models..."
              onKeyDown={handleKeyDown}
              className="pt-4 px-4 leading-[1.3]"
            />
            <PromptInputActions className="w-full justify-between p-2">
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                <ButtonPlusMenu
                  onFileUpload={onFileUpload}
                  isUserAuthenticated={isUserAuthenticated}
                  isFileUploadAvailable={isFileUploadAvailable}
                  enableSearch={enableSearch}
                  onToggleSearch={setEnableSearch}
                  isSearchDisabled={isSearchDisabled}
                  fileUploadDisabledMessage={fileUploadDisabledMessage}
                  searchDisabledMessage={searchDisabledMessage}
                />
              </div>
              <PromptInputAction
                tooltip={primaryAction.tooltip}
              >
                <Button
                  size="sm"
                  className="size-9 rounded-full transition-all duration-300 ease-out"
                  disabled={primaryAction.disabled}
                  type="button"
                  onClick={handlePrimaryActionClick}
                  aria-label={primaryAction.ariaLabel}
                >
                  {primaryAction.mode === "stop" ? (
                    <StopBulkRoundedIcon size={16} />
                  ) : (
                    <RiArrowUpLine size={20} className="size-5" />
                  )}
                </Button>
              </PromptInputAction>
            </PromptInputActions>
          </PromptInput>
        </div>
      </InputDropZone>
    </div>
  )
}
