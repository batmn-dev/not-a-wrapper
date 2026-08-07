"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { RiCheckLine, RiFileCopyLine } from "@remixicon/react"
import { useState } from "react"
import { Icon } from "./icon"

type ButtonCopyProps = {
  code: string | (() => string)
  label?: string
  variant?: "code" | "table"
}

export function ButtonCopy({
  code,
  label = "Copy",
  variant = "code",
}: ButtonCopyProps) {
  const [hasCopyLabel, setHasCopyLabel] = useState(false)

  const onCopy = () => {
    const value = typeof code === "function" ? code() : code
    void navigator.clipboard.writeText(value)
    setHasCopyLabel(true)

    setTimeout(() => {
      setHasCopyLabel(false)
    }, 1000)
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={onCopy}
            type="button"
            aria-label={hasCopyLabel ? "Copied" : label}
            className={cn(
              "code-copy-button inline-flex cursor-pointer items-center justify-center bg-transparent",
              variant === "code"
                ? "text-foreground hover:bg-interactive-hover active:bg-interactive-pressed pointer-events-auto size-9 rounded-full p-2"
                : "pointer-events-none relative z-10 my-1 size-7 rounded-[4px] p-1 text-[var(--text-secondary)] opacity-0 transition-opacity group-focus-within/markdown-table:pointer-events-auto group-focus-within/markdown-table:opacity-100 group-hover/markdown-table:pointer-events-auto group-hover/markdown-table:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
            )}
          />
        }
      >
        <Icon
          icon={hasCopyLabel ? RiCheckLine : RiFileCopyLine}
          slotSize={20}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {hasCopyLabel ? "Copied" : label}
      </TooltipContent>
    </Tooltip>
  )
}
