import * as React from "react"

const autosizeTextareaClassName =
  "col-start-1 col-end-2 row-start-1 row-end-2 w-full resize-none overflow-hidden p-0"

const AutosizeTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(function AutosizeTextarea({ className, value, ...props }, ref) {
  return (
    <div className="grid">
      <textarea
        ref={ref}
        className={`${autosizeTextareaClassName}${className ? ` ${className}` : ""}`}
        value={value}
        {...props}
      />
      <span className="invisible col-start-1 col-end-2 row-start-1 row-end-2 p-0 break-all whitespace-pre-wrap">
        {value}{" "}
      </span>
    </div>
  )
})

export { AutosizeTextarea }
