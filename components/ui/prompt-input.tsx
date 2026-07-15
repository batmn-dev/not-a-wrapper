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
 *   - ChatGPT-parity editor layout: a grid/alignment wrapper contains a
 *     separate capped overflow scroller, while the textarea uses native
 *     `field-sizing: content` instead of an imperative pixel height
 *   - Layout-loop hardening in PromptInputTextarea: the expansion decision is
 *     a pure function of (value, derived compact width) — it must not read
 *     layout that `textareaExpanded` itself influences; the passive effect
 *     skips values the change handler already laid out (consume-once ref);
 *     clone measurement is capped to a bounded prefix of the value
 * @upgradeNotes
 *   - Preserve autoFocus default on PromptInputTextarea
 *   - Do NOT re-add TooltipProvider wrapper in PromptInputAction
 *   - Verify useEffect vs useLayoutEffect for textarea auto-resize
 *   - Preserve the layout-loop hardening: no live-layout reads in the
 *     expansion decision, no double setTextareaExpanded dispatch per keystroke
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
  formControls?: React.ReactNode
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
  formControls,
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
        {formControls}
        <div className="relative">
          <div
            data-composer-surface="true"
            data-slot="prompt-input-surface"
            className="shadow-composer border-border-subtle relative grid cursor-text grid-cols-[auto_1fr_auto] overflow-clip rounded-[28px] border-0 bg-[var(--composer-bg)] bg-clip-padding px-2 py-[9px] contain-inline-size [grid-template-areas:'header_header_header'_'leading_primary_trailing'_'._footer_.'] group-not-data-[expanded]/composer:min-h-[52px] group-not-data-[expanded]/composer:py-[5px] group-data-[expanded]/composer:[grid-template-areas:'header_header_header'_'primary_primary_primary'_'leading_footer_trailing'] motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-in-out max-sm:[grid-template-areas:'header_header_header'_'primary_primary_primary'_'leading_footer_trailing']"
            onClick={() => {
              textareaRef.current?.focus()
            }}
          >
            {children}
          </div>
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

  const surface = textarea.closest<HTMLElement>(
    '[data-composer-surface="true"]'
  )
  const wrapper = textarea.closest<HTMLElement>(
    '[data-composer-editor-wrapper="true"]'
  )

  if (!surface || !wrapper) {
    return textarea.getBoundingClientRect().width
  }

  const surfaceStyle = getComputedStyle(surface)
  const wrapperStyle = getComputedStyle(wrapper)
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
      readPixels(wrapperStyle.paddingLeft) -
      readPixels(wrapperStyle.paddingRight)
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

/**
 * The expansion decision only needs "does this value wrap past one line?", so
 * measuring a bounded prefix is equivalent — no composer line fits anywhere
 * near this many characters. The cap keeps a pathological value (e.g. a 60k
 * character paste) from forcing a full clone layout of the entire text on
 * every keystroke.
 */
const EXPANSION_MEASURE_CHAR_LIMIT = 2000

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

      // Native field sizing keeps the live editor matched to its rendered
      // lines. Clear a stale imperative height left by an older render/HMR;
      // the nested scroller below, not the textarea, owns the height cap.
      textarea.style.removeProperty("height")

      const collapsedHeight = getCollapsedTextareaHeight(textarea)
      const compactWidth = getCompactTextareaWidth(textarea)
      const compactScrollHeight = measureTextareaScrollHeight(
        textarea,
        nextValue.slice(0, EXPANSION_MEASURE_CHAR_LIMIT),
        compactWidth
      )
      // The expansion decision is a function of the value and the DERIVED
      // compact width only. It must not read layout that `textareaExpanded`
      // itself influences (e.g. the live textarea scrollHeight, which changes
      // with the data-expanded grid/padding): state → CSS → measurement →
      // state is a feedback cycle, and a boundary value oscillates it into
      // React's "Maximum update depth exceeded" guard. The live term was also
      // redundant — the expanded textarea is never narrower than the compact
      // one, so any value that wraps live wraps in the compact measurement.
      const shouldExpand =
        nextValue.length > 0 &&
        (nextValue.includes("\n") || compactScrollHeight > collapsedHeight + 1)

      setTextareaExpanded(shouldExpand)
    },
    [disableAutosize, setTextareaExpanded]
  )

  // Consume-once handshake with handleChange: the effect exists for values
  // that arrive OUTSIDE a change event (mount, draft restore, quote insert,
  // clear-on-send). For typed input, handleChange already laid this exact
  // value out — re-dispatching setTextareaExpanded from the passive effect
  // both doubles the forced reflow per keystroke and feeds React's nested-
  // update accounting during rapid input.
  const eventLaidOutValueRef = useRef<string | null>(null)

  useEffect(() => {
    const alreadyLaidOut = eventLaidOutValueRef.current === value
    eventLaidOutValueRef.current = null
    if (alreadyLaidOut) return
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
    eventLaidOutValueRef.current = event.currentTarget.value
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
      data-composer-editor-wrapper="true"
      data-slot="prompt-input-editor-wrapper"
      className={cn(
        "-my-2.5 flex min-h-14 min-w-0 items-center overflow-x-hidden ps-1.75 pe-1.5 group-data-[expanded]/composer:mb-0 group-data-[expanded]/composer:px-2.5",
        containerClassName
      )}
    >
      <div
        data-composer-editor-scroller="true"
        data-slot="prompt-input-editor-scroller"
        className="min-w-0 flex-1 [scrollbar-width:thin] overflow-auto"
        style={{ maxHeight: maxHeightStyle }}
      >
        <Textarea
          ref={setTextareaRefs}
          autoFocus
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={cn(
            "text-foreground mt-4 block min-h-[42px] resize-none overflow-y-visible rounded-none border-none bg-transparent px-0 pt-0 pb-4 text-base leading-[26px] shadow-none transition-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent",
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
      className={cn("min-w-0 [grid-area:footer]", className)}
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
