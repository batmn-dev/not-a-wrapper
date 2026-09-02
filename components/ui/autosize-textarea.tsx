import * as React from "react"

const autosizeTextareaClassName =
  "col-start-1 col-end-2 row-start-1 row-end-2 w-full resize-none overflow-hidden p-0"

// Controlled-only: the sizing span mirrors `value`, so an uncontrolled
// textarea (defaultValue) would stop autosizing after the first edit.
type AutosizeTextareaProps = Omit<
  React.ComponentProps<"textarea">,
  "value" | "defaultValue"
> & {
  value: string
}

const AutosizeTextarea = React.forwardRef<
  HTMLTextAreaElement,
  AutosizeTextareaProps
>(function AutosizeTextarea({ className, value, ...props }, ref) {
  return (
    <div className="grid">
      <textarea
        ref={ref}
        className={`${autosizeTextareaClassName}${className ? ` ${className}` : ""}`}
        value={value}
        {...props}
      />
      <span
        aria-hidden
        className="invisible col-start-1 col-end-2 row-start-1 row-end-2 p-0 break-all whitespace-pre-wrap"
      >
        {value}{" "}
      </span>
    </div>
  )
})

export { AutosizeTextarea }
