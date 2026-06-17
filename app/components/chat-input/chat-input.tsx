"use client"

import { Button } from "@/components/ui/button"
import { ModelSelector } from "@/components/common/model-selector/base"
import { Icon } from "@/components/ui/icon"
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputFooter,
  PromptInputTextarea,
} from "@/components/ui/prompt-input"
import { StopBulkRoundedIcon } from "@/lib/icons"
import { getModelInfo } from "@/lib/models"
import { RiArrowUpLine } from "@remixicon/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PromptSystem } from "../suggestions/prompt-system"
import { ButtonPlusMenu } from "./button-plus-menu"
import { FileList } from "./file-list"
import { InputDropZone } from "./input-drop-zone"
import { resolveComposerPrimaryActionState } from "./primary-action-state"

type ChatInputProps = {
  defaultValue?: string
  onValueChange: (value: string) => void
  onSend: () => void
  isSubmitting?: boolean
  hasMessages?: boolean
  files: File[]
  onFileUpload: (files: File[]) => void
  onFileRemove: (file: File) => void
  onSuggestion: (suggestion: string) => void
  hasSuggestions?: boolean
  selectedModel: string
  onSelectModel?: (modelId: string) => void
  onLockedGuestModelSelect?: (modelId: string) => void
  isUserAuthenticated: boolean
  stop: () => void
  status?: "submitted" | "streaming" | "ready" | "error"
  setEnableSearch: (enabled: boolean) => void
  enableSearch: boolean
  quotedText?: { text: string; messageId: string } | null
  registerInputListener?: (listener: ((value: string) => void) | null) => void
  /** Callback to register a focus function so parents can imperatively focus the textarea */
  registerFocus?: (fn: (() => void) | null) => void
}

export function ChatInput({
  defaultValue = "",
  onValueChange,
  onSend,
  isSubmitting,
  files,
  onFileUpload,
  onFileRemove,
  onSuggestion,
  hasSuggestions,
  selectedModel,
  onSelectModel,
  onLockedGuestModelSelect,
  isUserAuthenticated,
  stop,
  status,
  setEnableSearch,
  enableSearch,
  quotedText,
  registerInputListener,
  registerFocus,
}: ChatInputProps) {
  const selectModelConfig = getModelInfo(selectedModel)
  // Web search is disabled only when the model explicitly can't accept tool calls
  // (tools: false) or has opted out of search (webSearch: false).
  // All other models get search via Layer 1 (provider-native) or Layer 2 (Exa fallback).
  const isSearchDisabled =
    selectModelConfig?.tools === false || selectModelConfig?.webSearch === false
  const isFileUploadAvailable = Boolean(selectModelConfig?.vision)
  const isOnlyWhitespace = (text: string) => !/[^\s]/.test(text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Expose a focus callback so parents / hooks can imperatively focus the textarea
  useEffect(() => {
    registerFocus?.(() => textareaRef.current?.focus())
    return () => registerFocus?.(null)
  }, [registerFocus])

  // Local state — ChatInput owns the displayed text to avoid re-renders in parent tree
  const [localValue, setLocalValue] = useState(defaultValue)

  // Sync when parent changes defaultValue (e.g. clearing input after submit in project view).
  // During normal typing the parent's defaultValue tracks localValue, so the set is a no-op.
  useEffect(() => {
    setLocalValue(defaultValue)
  }, [defaultValue])

  // Register local setState so use-chat-core can imperatively update display
  // (e.g. clear on submit, hydrate from ?prompt= search param)
  useEffect(() => {
    registerInputListener?.(setLocalValue)
    return () => registerInputListener?.(null)
  }, [registerInputListener])

  // Wrapper: updates local display state + notifies parent (ref + debounced draft)
  const handleValueChange = useCallback(
    (newValue: string) => {
      setLocalValue(newValue)
      onValueChange(newValue)
    },
    [onValueChange]
  )

  const primaryAction = useMemo(
    () =>
      resolveComposerPrimaryActionState({
        isStreaming: status === "streaming",
        isAbortable: status === "streaming",
        canSend: !isSubmitting && !isOnlyWhitespace(localValue),
      }),
    [isSubmitting, localValue, status]
  )

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

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      const hasImageContent = Array.from(items).some((item) =>
        item.type.startsWith("image/")
      )

      if (!isUserAuthenticated && hasImageContent) {
        e.preventDefault()
        return
      }

      if (isUserAuthenticated && hasImageContent) {
        const imageFiles: File[] = []

        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile()
            if (file) {
              const newFile = new File(
                [file],
                `pasted-image-${Date.now()}.${file.type.split("/")[1]}`,
                { type: file.type }
              )
              imageFiles.push(newFile)
            }
          }
        }

        if (imageFiles.length > 0) {
          onFileUpload(imageFiles)
        }
      }
      // Text pasting will work by default for everyone
    },
    [isUserAuthenticated, onFileUpload]
  )

  const valueRef = useRef(localValue)
  useEffect(() => {
    valueRef.current = localValue
  }, [localValue])

  useEffect(() => {
    if (quotedText) {
      const current = valueRef.current
      const quoted = quotedText.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")
      handleValueChange(
        current ? `${current}\n\n${quoted}\n\n` : `${quoted}\n\n`
      )

      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    }
  }, [quotedText, handleValueChange])

  return (
    <div className="relative flex w-full flex-col gap-4">
      {hasSuggestions && (
        <PromptSystem
          onValueChange={handleValueChange}
          onSuggestion={onSuggestion}
          value={localValue}
        />
      )}
      <InputDropZone
        onFileUpload={onFileUpload}
        disabled={!isUserAuthenticated || !isFileUploadAvailable}
      >
        <div
          className="relative order-2 pb-3 sm:pb-4 md:order-1"
          onClick={() => textareaRef.current?.focus()}
        >
          <PromptInput
            className="relative z-10"
            expanded={files.length > 0 || localValue.includes("\n")}
            maxHeight="max(30svh, 5rem)"
            value={localValue}
            onValueChange={handleValueChange}
          >
            <div className="[grid-area:header] min-w-0">
              <FileList files={files} onFileRemove={onFileRemove} />
            </div>
            <PromptInputActions
              className="[grid-area:leading] h-9 justify-start self-center"
              data-composer-leading="true"
              onClick={(e) => e.stopPropagation()}
            >
              <ButtonPlusMenu
                onFileUpload={onFileUpload}
                isUserAuthenticated={isUserAuthenticated}
                isFileUploadAvailable={isFileUploadAvailable}
                enableSearch={enableSearch}
                onToggleSearch={setEnableSearch}
                isSearchDisabled={isSearchDisabled}
              />
            </PromptInputActions>
            <PromptInputTextarea
              ref={textareaRef}
              placeholder="Ask anything"
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              containerClassName="[grid-area:primary]"
            />
            <PromptInputFooter aria-hidden="true" />
            <PromptInputActions
              className="[grid-area:trailing] h-9 min-w-[110px] justify-end gap-1.5 self-center sm:min-w-[154px]"
              data-composer-trailing="true"
              onClick={(e) => e.stopPropagation()}
            >
              {onSelectModel ? (
                <ModelSelector
                  selectedModelId={selectedModel}
                  setSelectedModelId={onSelectModel}
                  isUserAuthenticated={isUserAuthenticated}
                  onLockedGuestModelSelect={onLockedGuestModelSelect}
                  className="h-9 max-w-[68px] rounded-full px-3.5 py-0 text-sm font-normal text-muted-foreground hover:bg-black/5 aria-expanded:bg-black/5 dark:hover:bg-white/10 dark:aria-expanded:bg-white/10"
                />
              ) : null}
              {/* TODO: Add dictation here when the app exposes a local voice input capability. */}
              <PromptInputAction tooltip={primaryAction.tooltip}>
                <Button
                  size="sm"
                  className="size-9 rounded-full p-0 transition-colors duration-150 ease-out"
                  disabled={primaryAction.disabled}
                  type="button"
                  id="composer-submit-button"
                  data-testid="send-button"
                  onClick={handlePrimaryActionClick}
                  aria-label={primaryAction.ariaLabel}
                >
                  {primaryAction.mode === "stop" ? (
                    <StopBulkRoundedIcon size={16} />
                  ) : (
                    <Icon icon={RiArrowUpLine} slotSize={22} />
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
