import { ButtonCopy } from "@/components/ui/button-copy"
import { CodeBlockCode } from "@/components/ui/code-block"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ReactNode } from "react"

type ComponentPreviewProps = {
  children: ReactNode
  /** Copy-paste usage snippet shown under Code → Usage. */
  code: string
  /** Verbatim component source shown under Code → Source. */
  sourceCode: string
}

const codeTabTriggerClassName =
  "data-active:bg-muted h-8 rounded-lg px-3 font-normal data-active:shadow-none"

export function ComponentPreview({
  children,
  code,
  sourceCode,
}: ComponentPreviewProps) {
  return (
    <Tabs
      defaultValue="preview"
      className="flex-col gap-0 overflow-hidden rounded-xl border"
    >
      <div className="flex min-h-14 items-center border-b px-3">
        <TabsList className="h-9 rounded-lg bg-transparent p-0">
          <TabsTrigger
            value="preview"
            className="data-active:bg-muted h-9 rounded-lg px-3 font-normal data-active:shadow-none"
          >
            Preview
          </TabsTrigger>
          <TabsTrigger
            value="code"
            className="data-active:bg-muted h-9 rounded-lg px-3 font-normal data-active:shadow-none"
          >
            Code
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="preview"
        className="m-0 flex min-h-32 items-center justify-center p-8"
      >
        {children}
      </TabsContent>
      <TabsContent value="code" className="m-0 min-h-32">
        <Tabs defaultValue="usage" className="flex-col gap-0">
          <div className="flex min-h-12 items-center border-b px-3">
            <TabsList className="h-8 rounded-lg bg-transparent p-0">
              <TabsTrigger value="usage" className={codeTabTriggerClassName}>
                Usage
              </TabsTrigger>
              <TabsTrigger value="source" className={codeTabTriggerClassName}>
                Source
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="usage" className="relative m-0 min-h-32">
            <div className="absolute top-2 right-2 z-10">
              <ButtonCopy code={code} label="Copy usage code" />
            </div>
            <CodeBlockCode
              code={code}
              language="tsx"
              className="py-1 [&>pre]:pr-14"
            />
          </TabsContent>
          <TabsContent value="source" className="relative m-0 min-h-32">
            <div className="absolute top-2 right-2 z-10">
              <ButtonCopy code={sourceCode} label="Copy source code" />
            </div>
            {/* Source files run long; scroll inside the panel so the copy
                button stays pinned and the page keeps its rhythm. */}
            <div className="max-h-[32rem] overflow-y-auto">
              <CodeBlockCode
                code={sourceCode}
                language="tsx"
                className="py-1 [&>pre]:pr-14"
              />
            </div>
          </TabsContent>
        </Tabs>
      </TabsContent>
    </Tabs>
  )
}
