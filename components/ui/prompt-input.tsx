/**
 * @component PromptInput
 * @source prompt-kit
 * @upstream https://prompt-kit.com/docs/prompt-input
 * @customized true
 * @customizations
 *   - `autoFocus` is enabled by default on PromptInputTextarea
 *   - Removes redundant `TooltipProvider` wrapper in `PromptInputAction`
 *   - Not A Wrapper uses app-level TooltipProvider for consistency and smaller bundle
 *   - Upstream uses useLayoutEffect; Not A Wrapper uses standard useEffect for SSR safety
 * @upgradeNotes
 *   - Preserve autoFocus default on PromptInputTextarea
 *   - Do NOT re-add TooltipProvider wrapper in PromptInputAction
 *   - Verify useEffect vs useLayoutEffect for textarea auto-resize
 */
"use client"

import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

type PromptInputContextType = {
  isLoading: boolean
  value: string
  setValue: (value: string) => void
  maxHeight: number | string
  onSubmit?: () => void
  disabled?: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

const PromptInputContext = createContext<PromptInputContextType | undefined>(
  undefined
)

function usePromptInput() {
  const context = useContext(PromptInputContext)
  if (!context) {
    throw new Error("usePromptInput must be used within a PromptInput")
  }
  return context
}

type PromptInputProps = {
  isLoading?: boolean
  value?: string
  onValueChange?: (value: string) => void
  maxHeight?: number | string
  onSubmit?: () => void
  disabled?: boolean
  children: React.ReactNode
  className?: string
}

function PromptInput({
  className,
  isLoading = false,
  maxHeight = 240,
  value,
  onValueChange,
  onSubmit,
  disabled = false,
  children,
}: PromptInputProps) {
  const [internalValue, setInternalValue] = useState(value || "")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleChange = (newValue: string) => {
    setInternalValue(newValue)
    onValueChange?.(newValue)
  }

  return (
    <PromptInputContext.Provider
      value={{
        isLoading,
        value: value ?? internalValue,
        setValue: onValueChange ?? handleChange,
        maxHeight,
        onSubmit,
        disabled,
        textareaRef,
      }}
    >
      <div
        className={cn(
          "shadow-composer cursor-text overflow-clip rounded-[28px] border-0 border-black/5 bg-[var(--composer-bg)] bg-clip-padding contain-inline-size motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-in-out dark:border-white/5",
          className
        )}
        onClick={() => {
          textareaRef.current?.focus()
        }}
      >
        {children}
      </div>
    </PromptInputContext.Provider>
  )
}

export type PromptInputTextareaProps = {
  disableAutosize?: boolean
} & React.ComponentProps<typeof Textarea>

function PromptInputTextarea({
  className,
  onKeyDown,
  disableAutosize = false,
  ...props
}: PromptInputTextareaProps) {
  const { value, setValue, maxHeight, onSubmit, disabled, textareaRef } =
    usePromptInput()

  useEffect(() => {
    if (disableAutosize || !textareaRef.current) return

    // Reset height to auto first to properly measure scrollHeight
    textareaRef.current.style.height = "auto"

    // Set the height based on content
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
  }, [value, disableAutosize, textareaRef])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      onSubmit?.()
    }
    onKeyDown?.(e)
  }

  const maxHeightStyle =
    typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight

  return (
    <Textarea
      ref={textareaRef}
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      className={cn(
        "text-primary min-h-[44px] resize-none overflow-y-auto border-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 md:text-base dark:bg-transparent",
        className
      )}
      style={{
        maxHeight: maxHeightStyle,
      }}
      rows={1}
      disabled={disabled}
      {...props}
    />
  )
}

type PromptInputActionsProps = React.HTMLAttributes<HTMLDivElement>

function PromptInputActions({
  children,
  className,
  ...props
}: PromptInputActionsProps) {
  return (
    <div className={cn("flex items-center gap-1", className)} {...props}>
      {children}
    </div>
  )
}

type PromptInputActionProps = {
  className?: string
  tooltip: React.ReactNode
  children: React.ReactElement
  side?: "top" | "bottom" | "left" | "right"
  hideArrow?: boolean
} & React.ComponentProps<typeof Tooltip>

function PromptInputAction({
  tooltip,
  children,
  className,
  side = "bottom",
  hideArrow = true,
  ...tooltipProps
}: PromptInputActionProps) {
  const { disabled } = usePromptInput()
  const trigger = useRender({
    defaultTagName: "button",
    render: children,
    props: mergeProps<"button">(
      {
        type: "button",
        disabled,
        onClick: (event) => event.stopPropagation(),
      },
      {}
    ),
  })

  return (
    <Tooltip {...tooltipProps}>
      <TooltipTrigger render={trigger} disabled={disabled} />
      <TooltipContent side={side} hideArrow={hideArrow} className={className}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

export {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
}
