import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { Metadata } from "next"

const defaultCode = `import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"

export function PopoverDefault() {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>
        Open popover
      </PopoverTrigger>
      <PopoverContent className="p-4">
        <PopoverHeader>
          <PopoverTitle>Dimensions</PopoverTitle>
          <PopoverDescription>
            Set the dimensions for the layer.
          </PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  )
}`

const apiRows = [
  {
    prop: "open / onOpenChange",
    type: "boolean / (open, eventDetails) => void",
    defaultValue: "—",
    description: "Controlled open state and its change handler, on the root.",
  },
  {
    prop: "PopoverTrigger render",
    type: "ReactElement | render function",
    defaultValue: "—",
    description:
      "Composes the trigger onto another element, typically a Button.",
  },
  {
    prop: "PopoverContent side",
    type: '"top" | "right" | "bottom" | "left" | ...',
    defaultValue: '"bottom"',
    description: "Which side of the trigger the popover is placed on.",
  },
  {
    prop: "PopoverContent sideOffset",
    type: "number",
    defaultValue: "4",
    description: "Distance in px between the popover and the trigger.",
  },
  {
    prop: "PopoverContent align",
    type: '"start" | "center" | "end"',
    defaultValue: '"center"',
    description: "Alignment against the trigger along the chosen side.",
  },
  {
    prop: "PopoverContent alignOffset",
    type: "number",
    defaultValue: "0",
    description: "Additional offset along the alignment axis, in px.",
  },
] as const

export const metadata: Metadata = {
  title: "Popover | Design System",
  description:
    "Documentation and usage for the Not A Wrapper Popover component.",
}

export default function PopoverPage() {
  const popoverSource = readComponentSource("components/ui/popover.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="popover"
        title="Popover"
        description="Click-triggered floating surface anchored to its trigger, built on the Base UI popover with positioner options surfaced on the content."
      />

      <DsSection
        id="default"
        title="Default"
        description="The content defaults to menu-tight p-1.5; pad up (p-4 here) for prose. The surface outline comes from shadow-border, so do not add border classes."
      >
        <ComponentPreview code={defaultCode} sourceCode={popoverSource}>
          <Popover>
            <PopoverTrigger render={<Button variant="outline" />}>
              Open popover
            </PopoverTrigger>
            <PopoverContent className="p-4">
              <PopoverHeader>
                <PopoverTitle>Dimensions</PopoverTitle>
                <PopoverDescription>
                  Set the dimensions for the layer.
                </PopoverDescription>
              </PopoverHeader>
            </PopoverContent>
          </Popover>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 28, 12, 34]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Popover props are forwarded from each wrapper.
          PopoverContent renders its own portal and positioner, so pages only
          compose the root, trigger, and content.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
