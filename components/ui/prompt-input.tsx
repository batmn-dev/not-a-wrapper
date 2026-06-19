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
  setTextareaExpanded: React.Dispatch<React.SetStateAction<boolean>>
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
  expanded?: boolean
  maxHeight?: number | string
  onSubmit?: () => void
  disabled?: boolean
  children: React.ReactNode
  className?: string
}

function PromptInput({
  className,
  isLoading = false,
  expanded = false,
  maxHeight = 240,
  value,
  onValueChange,
  onSubmit,
  disabled = false,
  children,
}: PromptInputProps) {
  const [internalValue, setInternalValue] = useState(value || "")
  const [textareaExpanded, setTextareaExpanded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isExpanded = expanded || textareaExpanded

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
        setTextareaExpanded,
        maxHeight,
        onSubmit,
        disabled,
        textareaRef,
      }}
    >
      <form
        autoComplete="off"
        className={cn("group/composer w-full", className)}
        data-expanded={isExpanded ? "" : undefined}
        data-type="unified-composer"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit?.()
        }}
      >
        <div
          data-composer-surface="true"
          data-slot="prompt-input-surface"
          className="shadow-composer relative grid min-h-[84px] grid-cols-[auto_1fr_auto] grid-rows-[auto_minmax(38px,auto)_36px] [grid-template-areas:'header_header_header'_'primary_primary_primary'_'leading_footer_trailing'] cursor-text overflow-clip rounded-[28px] border-0 border-black/5 bg-[var(--composer-bg)] bg-clip-padding py-[5px] ps-[7px] pe-2 contain-inline-size motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-in-out sm:min-h-[52px] sm:grid-rows-[auto_minmax(42px,auto)_0px] sm:[grid-template-areas:'header_header_header'_'leading_primary_trailing'_'._footer_.'] group-data-[expanded]/composer:grid-rows-[auto_minmax(38px,auto)_36px] group-data-[expanded]/composer:[grid-template-areas:'header_header_header'_'primary_primary_primary'_'leading_footer_trailing'] sm:group-data-[expanded]/composer:min-h-[102px] sm:group-data-[expanded]/composer:grid-rows-[auto_minmax(56px,auto)_36px] dark:border-white/5"
          onClick={() => {
            textareaRef.current?.focus()
          }}
        >
          {children}
        </div>
      </form>
    </PromptInputContext.Provider>
  )
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === "function") {
    ref(value)
    return
  }
  ;(ref as React.MutableRefObject<T | null>).current = value
}

function readPixels(value: string) {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getCompactTextareaWidth(textarea: HTMLTextAreaElement) {
  if (window.matchMedia("(max-width: 639px)").matches) {
    return textarea.getBoundingClientRect().width
  }

  const surface = textarea.closest<HTMLElement>('[data-composer-surface="true"]')
  const scroller = textarea.closest<HTMLElement>(
    '[data-composer-editor-scroller="true"]'
  )

  if (!surface || !scroller) {
    return textarea.getBoundingClientRect().width
  }

  const surfaceStyle = getComputedStyle(surface)
  const scrollerStyle = getComputedStyle(scroller)
  const contentWidth =
    surface.getBoundingClientRect().width -
    readPixels(surfaceStyle.paddingLeft) -
    readPixels(surfaceStyle.paddingRight)
  const leadingWidth =
    surface
      .querySelector<HTMLElement>('[data-composer-leading="true"]')
      ?.getBoundingClientRect().width ?? 36
  const trailingWidth =
    surface
      .querySelector<HTMLElement>('[data-composer-trailing="true"]')
      ?.getBoundingClientRect().width ?? 0

  return Math.max(
    0,
    contentWidth -
      leadingWidth -
      trailingWidth -
      readPixels(scrollerStyle.paddingLeft) -
      readPixels(scrollerStyle.paddingRight)
  )
}

function measureTextareaScrollHeight(
  textarea: HTMLTextAreaElement,
  value: string,
  width: number
) {
  const clone = textarea.cloneNode() as HTMLTextAreaElement
  clone.removeAttribute("id")
  clone.removeAttribute("name")
  clone.tabIndex = -1
  clone.value = value || " "
  clone.rows = 1
  clone.style.position = "absolute"
  clone.style.visibility = "hidden"
  clone.style.pointerEvents = "none"
  clone.style.zIndex = "-1"
  clone.style.top = "0"
  clone.style.left = "0"
  clone.style.height = "auto"
  clone.style.minHeight = "0"
  clone.style.maxHeight = "none"
  clone.style.overflow = "hidden"
  clone.style.width = `${width}px`

  document.body.appendChild(clone)
  const scrollHeight = clone.scrollHeight
  clone.remove()
  return scrollHeight
}

function getCollapsedTextareaHeight(textarea: HTMLTextAreaElement) {
  const styles = getComputedStyle(textarea)
  return (
    readPixels(styles.lineHeight) +
    readPixels(styles.paddingTop) +
    readPixels(styles.paddingBottom)
  )
}

export type PromptInputTextareaProps = {
  disableAutosize?: boolean
  containerClassName?: string
} & React.ComponentProps<typeof Textarea>

function PromptInputTextarea({
  className,
  containerClassName,
  onKeyDown,
  disableAutosize = false,
  style,
  ref,
  ...props
}: PromptInputTextareaProps) {
  const {
    value,
    setValue,
    setTextareaExpanded,
    maxHeight,
    onSubmit,
    disabled,
    textareaRef,
  } = usePromptInput()

  const applyTextareaLayout = React.useCallback(
    (textarea: HTMLTextAreaElement | null, nextValue: string) => {
      if (disableAutosize || !textarea) {
        setTextareaExpanded(false)
        return
      }

      textarea.style.height = "auto"

      const collapsedHeight = getCollapsedTextareaHeight(textarea)
      const compactWidth = getCompactTextareaWidth(textarea)
      const compactScrollHeight = measureTextareaScrollHeight(
        textarea,
        nextValue,
        compactWidth
      )
      const currentScrollHeight = textarea.scrollHeight
      const shouldExpand =
        nextValue.length > 0 &&
        (nextValue.includes("\n") ||
          compactScrollHeight > collapsedHeight + 1 ||
          currentScrollHeight > collapsedHeight + 1)

      textarea.style.height = `${Math.max(collapsedHeight, currentScrollHeight)}px`
      setTextareaExpanded(shouldExpand)
    },
    [disableAutosize, setTextareaExpanded]
  )

  useEffect(() => {
    applyTextareaLayout(textareaRef.current, value)
  }, [applyTextareaLayout, textareaRef, value])

  const setTextareaRefs = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node
      assignRef(ref, node)
    },
    [ref, textareaRef]
  )

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    applyTextareaLayout(event.currentTarget, event.currentTarget.value)
    setValue(event.currentTarget.value)
  }

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
    <div
      data-composer-editor-scroller="true"
      data-slot="prompt-input-editor-scroller"
      className={cn(
        "flex min-h-[38px] min-w-0 items-center overflow-x-hidden overflow-y-auto px-1.5 [scrollbar-width:thin] group-data-[expanded]/composer:min-h-14 group-data-[expanded]/composer:px-2.5 sm:-my-2.5 sm:min-h-14 sm:group-data-[expanded]/composer:my-0 sm:group-data-[expanded]/composer:min-h-14",
        containerClassName
      )}
      style={{ maxHeight: maxHeightStyle }}
    >
      <Textarea
        ref={setTextareaRefs}
        autoFocus
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={cn(
          "text-primary block min-h-[38px] resize-none overflow-y-visible rounded-none border-none bg-transparent px-0 pt-1 pb-2 text-base leading-[26px] shadow-none transition-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:min-h-10 sm:pt-[6px] sm:pb-2 dark:bg-transparent",
          className
        )}
        style={{
          ...style,
          lineHeight: "26px",
          overflowY: "hidden",
          whiteSpace: "break-spaces",
        }}
        rows={1}
        disabled={disabled}
        {...props}
      />
    </div>
  )
}

type PromptInputFooterProps = React.HTMLAttributes<HTMLDivElement>

function PromptInputFooter({
  children,
  className,
  ...props
}: PromptInputFooterProps) {
  return (
    <div
      data-composer-footer="true"
      data-slot="prompt-input-footer"
      className={cn("[grid-area:footer] min-w-0", className)}
      {...props}
    >
      {children}
    </div>
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
  PromptInputFooter,
  PromptInputActions,
  PromptInputAction,
}
