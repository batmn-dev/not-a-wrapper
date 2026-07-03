"use client"

/**
 * Composer — the deep client module that assembles a Chat turn payload. See
 * CONTEXT.md "Composer".
 *
 * It owns the draft (display state + per-chat persistence + clearing), the
 * pending attachment files, suggestion UI, paste/drop capture, and the primary
 * action; it reads the model picker and search toggle from the Turn context
 * and auth from the user store directly. Its interface to the parent is one
 * payload callback (`onTurn`) plus a small imperative handle for external
 * commands (quote insertion, ?prompt= hydration, focus) — replacing the
 * former 21-prop ChatInput and its parent-side orchestration memo.
 *
 * Draft contract: the display clears at send handoff; the PERSISTED draft
 * clears only when `onTurn` resolves `true` (the turn was dispatched). A
 * rejected turn (`false`) restores the payload into the composer — the error
 * toast must not fire over an emptied box.
 */
import { useTurnContext } from "@/app/components/chat/turn-context"
import { useFileUpload } from "@/app/components/chat/use-file-upload"
import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import { useChatDraft } from "@/app/hooks/use-chat-draft"
import { ModelSelector } from "@/components/common/model-selector/base"
import { Button } from "@/components/ui/button"
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
import { useUser } from "@/lib/user-store/provider"
import { debounce } from "@/lib/utils"
import { RiArrowUpLine } from "@remixicon/react"
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import { PromptSystem } from "../suggestions/prompt-system"
import { ButtonPlusMenu } from "./button-plus-menu"
import { FileList } from "./file-list"
import { InputDropZone } from "./input-drop-zone"
import { resolveComposerPrimaryActionState } from "./primary-action-state"

export type ComposerTurnPayload = {
  text: string
  files: File[]
}

export type ComposerHandle = {
  /** Append quoted text ("> …") to the draft and focus the textarea. */
  insertQuote: (text: string) => void
  /** Replace the display text (e.g. ?prompt= hydration). Display only — does
   * not write the persisted draft. */
  setText: (text: string) => void
  focus: () => void
}

type ComposerProps = {
  chatId: string | null
  /** Run one send-type Chat turn from the assembled payload. Resolve `true`
   * when the turn was dispatched (the Composer clears its persisted draft) or
   * `false` when it was rejected (the Composer restores the payload). The
   * boolean is required: a `void` handler would silently take the
   * restore-payload path after every successful send. */
  onTurn: (payload: ComposerTurnPayload) => Promise<boolean> | boolean
  onSuggestion?: (suggestion: string) => void | Promise<void>
  isSubmitting?: boolean
  status?: "submitted" | "streaming" | "ready" | "error"
  stop?: () => void
  hasSuggestions?: boolean
  onLockedGuestModelSelect?: (modelId: string) => void
  /** Draft-persistence scope when there is no chat id (e.g. `project-<id>`),
   * so surface drafts don't bleed into the home composer's "new chat" draft. */
  draftScopeId?: string
}

const isOnlyWhitespace = (text: string) => !/[^\s]/.test(text)

type ComposerDraftIdentity = {
  persistenceId: string | null
  displayId: string
}

function resolveComposerDraftIdentity(
  chatId: string | null,
  draftScopeId?: string
): ComposerDraftIdentity {
  if (chatId) {
    return {
      persistenceId: chatId,
      displayId: `chat:${chatId}`,
    }
  }

  if (draftScopeId) {
    return {
      persistenceId: draftScopeId,
      displayId: `scope:${draftScopeId}`,
    }
  }

  return {
    persistenceId: null,
    displayId: "new-chat",
  }
}

function useComposerDraftDisplay(
  draftIdentity: ComposerDraftIdentity,
  draftValue: string
) {
  const [localValue, setLocalValue] = useState(() => draftValue)
  const valueRef = useRef(localValue)
  const draftSyncRef = useRef({
    displayId: draftIdentity.displayId,
    hasLocalOverride: false,
    lastDraftValue: draftValue,
  })

  const adoptDraftValue = useCallback((newValue: string) => {
    draftSyncRef.current.hasLocalOverride = false
    valueRef.current = newValue
    setLocalValue(newValue)
  }, [])

  const applyValue = useCallback((newValue: string) => {
    draftSyncRef.current.hasLocalOverride = true
    valueRef.current = newValue
    setLocalValue(newValue)
  }, [])

  useBrowserLayoutEffect(() => {
    const currentDraft = draftSyncRef.current

    if (currentDraft.displayId !== draftIdentity.displayId) {
      draftSyncRef.current = {
        displayId: draftIdentity.displayId,
        hasLocalOverride: false,
        lastDraftValue: draftValue,
      }

      adoptDraftValue(draftValue)
      return
    }

    if (currentDraft.lastDraftValue === draftValue) {
      return
    }

    currentDraft.lastDraftValue = draftValue
    if (!currentDraft.hasLocalOverride && draftValue !== valueRef.current) {
      adoptDraftValue(draftValue)
    }
  }, [adoptDraftValue, draftIdentity.displayId, draftValue])

  return { localValue, valueRef, applyValue }
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      chatId,
      onTurn,
      onSuggestion,
      isSubmitting,
      status,
      stop,
      hasSuggestions,
      onLockedGuestModelSelect,
      draftScopeId,
    },
    ref
  ) {
    const { user } = useUser()
    const isUserAuthenticated = !!user?.id
    const { selectedModel, handleModelChange, enableSearch, setEnableSearch } =
      useTurnContext()

    const selectModelConfig = getModelInfo(selectedModel)
    // Web search is disabled only when the model explicitly can't accept tool calls
    // (tools: false) or has opted out of search (webSearch: false).
    // All other models get search via Layer 1 (provider-native) or Layer 2 (Exa fallback).
    const isSearchDisabled =
      selectModelConfig?.tools === false ||
      selectModelConfig?.webSearch === false
    const isFileUploadAvailable = Boolean(selectModelConfig?.vision)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    // Pending attachments — Composer-owned; uploaded at turn time from the
    // payload, not from shared state.
    const {
      files,
      handleFileUpload,
      handleFileRemove,
      clearFiles,
      restoreFiles,
    } = useFileUpload()

    // Draft: display state here, persistence per chat (or per scope) in
    // localStorage via useChatDraft, debounced per keystroke. Scoped no-chat
    // surfaces and chat routes are identity-isolated, so route changes adopt
    // the active key's persisted draft instead of retaining the previous display.
    const draftIdentity = useMemo(
      () => resolveComposerDraftIdentity(chatId, draftScopeId),
      [chatId, draftScopeId]
    )
    const { draftValue, setDraftValue, clearDraft } = useChatDraft(
      draftIdentity.persistenceId
    )
    const { localValue, valueRef, applyValue } = useComposerDraftDisplay(
      draftIdentity,
      draftValue
    )

    const debouncedSetDraftValue = useMemo(
      () => debounce((value: string) => setDraftValue(value), 500),
      [setDraftValue]
    )

    // Flush pending draft on tab close; also flush on unmount and when the
    // draft key changes (navigation), so the old chat's pending write lands.
    useEffect(() => {
      const flush = () => debouncedSetDraftValue.flush()
      window.addEventListener("beforeunload", flush)
      return () => {
        window.removeEventListener("beforeunload", flush)
        debouncedSetDraftValue.flush()
      }
    }, [debouncedSetDraftValue])

    // The ref mirrors the display text and is written SYNCHRONOUSLY by
    // useComposerDraftDisplay at every write site (event/imperative time, never
    // during render), so a send in the same tick as a text change always reads
    // the current text — the same guarantee the pre-Composer inputRef gave.
    const handleValueChange = useCallback(
      (newValue: string) => {
        applyValue(newValue)
        debouncedSetDraftValue(newValue)
      },
      [applyValue, debouncedSetDraftValue]
    )

    const handleSend = useCallback(async () => {
      const text = valueRef.current
      const submittedFiles = files
      // Clear the display at handoff; the persisted draft survives until the
      // turn reports success. Clearing through applyValue also empties the
      // ref synchronously, so a second Enter in the same commit cannot
      // re-send the old text.
      applyValue("")
      const fileRestoreToken = clearFiles()
      const accepted = await onTurn({ text, files: submittedFiles })
      if (accepted === true) {
        debouncedSetDraftValue.cancel()
        clearDraft()
        return
      }
      // Rejected turn (guard failure, limit, network error): put the payload
      // back so the user can fix and resend — the error toast must not fire
      // over an emptied composer. Skip the text restore if the user already
      // started a new draft while the turn was in flight.
      if (text && valueRef.current === "") {
        applyValue(text)
      }
      restoreFiles(submittedFiles, fileRestoreToken)
    }, [
      applyValue,
      files,
      clearFiles,
      restoreFiles,
      onTurn,
      debouncedSetDraftValue,
      clearDraft,
      valueRef,
    ])

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
        stop?.()
        return
      }

      void handleSend()
    }, [handleSend, primaryAction.disabled, primaryAction.intent, stop])

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
          void handleSend()
        }
      },
      [handleSend, primaryAction.disabled, primaryAction.mode]
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
            handleFileUpload(imageFiles)
          }
        }
        // Text pasting will work by default for everyone
      },
      [isUserAuthenticated, handleFileUpload]
    )

    useImperativeHandle(
      ref,
      () => ({
        insertQuote: (text: string) => {
          const current = valueRef.current
          const quoted = text
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")
          handleValueChange(
            current ? `${current}\n\n${quoted}\n\n` : `${quoted}\n\n`
          )
          requestAnimationFrame(() => {
            textareaRef.current?.focus()
          })
        },
        setText: (text: string) => {
          applyValue(text)
        },
        focus: () => {
          textareaRef.current?.focus()
        },
      }),
      [applyValue, handleValueChange, valueRef]
    )

    return (
      <div className="relative flex w-full flex-col gap-4">
        {hasSuggestions && (
          <PromptSystem
            onValueChange={handleValueChange}
            onSuggestion={(suggestion) => void onSuggestion?.(suggestion)}
            value={localValue}
          />
        )}
        <InputDropZone
          onFileUpload={handleFileUpload}
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
              <div className="min-w-0 [grid-area:header]">
                <FileList files={files} onFileRemove={handleFileRemove} />
              </div>
              <PromptInputActions
                className="h-9 justify-start self-center [grid-area:leading]"
                data-composer-leading="true"
                onClick={(e) => e.stopPropagation()}
              >
                <ButtonPlusMenu
                  onFileUpload={handleFileUpload}
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
                className="cant-hover:gap-1.5 h-9 gap-1 self-center [grid-area:trailing]"
                data-composer-trailing="true"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="cant-hover:gap-1.5 cant-hover:px-1.5 relative ms-1 flex items-center gap-1.5">
                  <ModelSelector
                    variant="composer"
                    selectedModelId={selectedModel}
                    setSelectedModelId={handleModelChange}
                    isUserAuthenticated={isUserAuthenticated}
                    onLockedGuestModelSelect={onLockedGuestModelSelect}
                  />
                </div>
                <div className="cant-hover:gap-1.5 ms-auto flex items-center gap-2">
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
                        <StopBulkRoundedIcon slotSize={22} glyphSize={22} />
                      ) : (
                        <Icon icon={RiArrowUpLine} slotSize={22} />
                      )}
                    </Button>
                  </PromptInputAction>
                </div>
              </PromptInputActions>
            </PromptInput>
          </div>
        </InputDropZone>
      </div>
    )
  }
)
