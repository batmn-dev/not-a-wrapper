import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import type { Metadata } from "next"

const defaultCode = `import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

export function ResizableDefault() {
  return (
    <ResizablePanelGroup className="h-44 w-full max-w-sm rounded-xl border">
      <ResizablePanel defaultSize="50%" minSize="20%">
        <div className="flex h-full items-center justify-center p-6">
          <span className="font-semibold">One</span>
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="50%" minSize="20%">
        <div className="flex h-full items-center justify-center p-6">
          <span className="font-semibold">Two</span>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}`

const apiRows = [
  {
    prop: "ResizablePanelGroup orientation",
    type: '"horizontal" | "vertical"',
    defaultValue: '"horizontal"',
    description: "Layout axis of the group and the direction panels resize in.",
  },
  {
    prop: "ResizablePanel defaultSize",
    type: "number | string",
    defaultValue: "auto",
    description:
      'Initial size within the group, e.g. "50%" or a pixel number. Auto-distributed when omitted.',
  },
  {
    prop: "ResizablePanel minSize / maxSize",
    type: "number | string",
    defaultValue: '"0%" / "100%"',
    description: "Resize bounds for the panel.",
  },
  {
    prop: "ResizablePanel collapsible / collapsedSize",
    type: "boolean / number | string",
    defaultValue: 'false / "0%"',
    description:
      "Lets the panel snap to collapsedSize when dragged below minSize.",
  },
  {
    prop: "ResizableHandle withHandle",
    type: "boolean",
    defaultValue: "false",
    description: "Draws the visible grip chip on the separator.",
  },
] as const

export const metadata: Metadata = {
  title: "Resizable | Design System",
  description:
    "Draggable panel groups built on react-resizable-panels with a styled separator handle.",
}

export default function ResizablePage() {
  const resizableSource = readComponentSource("components/ui/resizable.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="resizable"
        title="Resizable"
        description="Panel groups from react-resizable-panels with a hairline separator, keyboard-resizable focus ring, and an optional grip handle."
      />

      <DsSection
        id="default"
        title="Default"
        description="Drag the separator to trade space between panels; it is focusable and arrow-key resizable. minSize keeps either side from collapsing entirely."
      >
        <ComponentPreview code={defaultCode} sourceCode={resizableSource}>
          <ResizablePanelGroup className="h-44 w-full max-w-sm rounded-xl border">
            <ResizablePanel defaultSize="50%" minSize="20%">
              <div className="flex h-full items-center justify-center p-6">
                <span className="font-semibold">One</span>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="50%" minSize="20%">
              <div className="flex h-full items-center justify-center p-6">
                <span className="font-semibold">Two</span>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[28, 22, 14, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          All remaining react-resizable-panels Group, Panel, and Separator props
          (onLayoutChange, onResize, id for persisted layouts, disabled) are
          forwarded by each wrapper.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
