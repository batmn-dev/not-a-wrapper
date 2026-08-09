import { ComponentPreviewCode } from "@/app/design-system/_components/component-preview-code"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ReactNode } from "react"

type ComponentPreviewProps = {
  children: ReactNode
  /**
   * Copy-paste usage snippet shown under Code → Usage. When the preview is
   * backed by a demo file, pass that file's source (readComponentSource) so
   * the snippet cannot drift from what renders.
   */
  code: string
  /** Verbatim component source shown under Code → Source. */
  sourceCode: string
}

/* Screenshot spec: labels ride directly on the panel — the active underline
   sits at the very bottom of the tab row, flush against the panel's top
   border, and the row is inset so labels clear the panel's rounded corner.

   Continuous hover (same principle as the sidebar's menu-item-hoverable):
   the space between tabs lives INSIDE each trigger as padding, so hover
   hands off from tab to tab with no dead zone, while the underline is
   inset back to hug the label (2px overhang, matching the outer edges). */
const viewTabTriggerClassName = [
  "h-full px-3 first:pl-0.5 last:pr-0.5",
  "group-data-horizontal/tabs:after:-bottom-px group-data-horizontal/tabs:after:h-px",
  "group-data-horizontal/tabs:after:left-2.5 group-data-horizontal/tabs:after:right-2.5",
  "group-data-horizontal/tabs:first:after:left-0 group-data-horizontal/tabs:last:after:right-0",
].join(" ")

export function ComponentPreview({
  children,
  code,
  sourceCode,
}: ComponentPreviewProps) {
  return (
    <Tabs defaultValue="preview" className="flex-col gap-0">
      <TabsList
        variant="line"
        className="gap-0 px-(--ds-align-spacer) py-0 group-data-horizontal/tabs:h-10"
      >
        <TabsTrigger value="preview" className={viewTabTriggerClassName}>
          Preview
        </TabsTrigger>
        <TabsTrigger value="code" className={viewTabTriggerClassName}>
          Code
        </TabsTrigger>
      </TabsList>

      <TabsContent
        value="preview"
        className="m-0 flex aspect-[5/4] items-center justify-center rounded-2xl border p-8"
      >
        {children}
      </TabsContent>
      <TabsContent
        value="code"
        className="m-0 min-h-32 overflow-hidden rounded-2xl border"
      >
        <ComponentPreviewCode code={code} sourceCode={sourceCode} />
      </TabsContent>
    </Tabs>
  )
}
