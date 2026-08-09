"use client"

import { ButtonCopy } from "@/components/ui/button-copy"
import { CodeBlockCode } from "@/components/ui/code-block"
import { Icon } from "@/components/ui/icon"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { RiTextWrap } from "@remixicon/react"
import { useState } from "react"

type CodeView = "usage" | "source"

type ComponentPreviewCodeProps = {
  /** Copy-paste usage snippet shown under Usage. */
  code: string
  /** Verbatim component source shown under Source. */
  sourceCode: string
}

/* The inner tabs are controlled so the header's copy button always targets
   the visible view. */
export function ComponentPreviewCode({
  code,
  sourceCode,
}: ComponentPreviewCodeProps) {
  const [view, setView] = useState<CodeView>("usage")
  const [isWrapped, setIsWrapped] = useState(false)

  /* Long lines scroll horizontally by default; wrapping folds them onto the
     next line instead. */
  const wrapClassName = isWrapped
    ? "[&_pre]:whitespace-pre-wrap [&_pre]:break-words"
    : undefined
  const wrapLabel = isWrapped ? "Unwrap code" : "Wrap code"

  return (
    <Tabs
      value={view}
      onValueChange={(value) => setView(value as CodeView)}
      className="flex-col gap-0"
    >
      <div className="flex min-h-12 items-center justify-between pr-1.5 pl-2">
        <TabsList variant="ghost" className="group-data-horizontal/tabs:h-8">
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="source">Source</TabsTrigger>
        </TabsList>
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => setIsWrapped((wrapped) => !wrapped)}
                  aria-pressed={isWrapped}
                  aria-label={wrapLabel}
                  className="text-foreground hover:bg-interactive-hover active:bg-interactive-pressed inline-flex size-9 cursor-pointer items-center justify-center rounded-full bg-transparent p-2"
                />
              }
            >
              <Icon icon={RiTextWrap} slotSize={20} />
            </TooltipTrigger>
            <TooltipContent side="bottom">{wrapLabel}</TooltipContent>
          </Tooltip>
          <ButtonCopy
            code={view === "usage" ? code : sourceCode}
            label={view === "usage" ? "Copy usage code" : "Copy source code"}
          />
        </div>
      </div>
      <TabsContent value="usage" className="m-0 min-h-32">
        <CodeBlockCode
          code={code.trimEnd()}
          language="tsx"
          className={cn("py-1", wrapClassName)}
        />
      </TabsContent>
      <TabsContent value="source" className="m-0 min-h-32">
        <CodeBlockCode
          code={sourceCode.trimEnd()}
          language="tsx"
          className={cn("py-1", wrapClassName)}
        />
      </TabsContent>
    </Tabs>
  )
}
