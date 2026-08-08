import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  RiAlignCenter,
  RiAlignLeft,
  RiAlignRight,
  RiBold,
  RiItalic,
  RiUnderline,
} from "@remixicon/react"
import type { Metadata } from "next"

const singleCode = `import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { RiAlignCenter, RiAlignLeft, RiAlignRight } from "@remixicon/react"

export function ToggleGroupSingle() {
  return (
    <ToggleGroup defaultValue={["left"]} variant="outline">
      <ToggleGroupItem value="left" aria-label="Align left">
        <RiAlignLeft />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Align center">
        <RiAlignCenter />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right">
        <RiAlignRight />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}`

const multipleCode = `import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { RiBold, RiItalic, RiUnderline } from "@remixicon/react"

export function ToggleGroupMultiple() {
  return (
    <ToggleGroup multiple defaultValue={["bold", "italic"]} spacing={4}>
      <ToggleGroupItem value="bold" aria-label="Toggle bold">
        <RiBold />
      </ToggleGroupItem>
      <ToggleGroupItem value="italic" aria-label="Toggle italic">
        <RiItalic />
      </ToggleGroupItem>
      <ToggleGroupItem value="underline" aria-label="Toggle underline">
        <RiUnderline />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}`

const apiRows = [
  {
    prop: "value / onValueChange",
    type: "string[] / (value, details) => void",
    defaultValue: "—",
    description:
      "Controlled pressed values (always an array) and the change handler.",
  },
  {
    prop: "defaultValue",
    type: "string[]",
    defaultValue: "—",
    description: "Initially pressed values when uncontrolled.",
  },
  {
    prop: "multiple",
    type: "boolean",
    defaultValue: "false",
    description:
      "Allows several items to be pressed at once instead of exclusive selection.",
  },
  {
    prop: "variant / size",
    type: '"default" | "outline" / "default" | "sm" | "lg"',
    defaultValue: '"default"',
    description:
      "Toggle variants applied to every item through context; items may override.",
  },
  {
    prop: "spacing",
    type: "number",
    defaultValue: "0",
    description:
      "Pixel gap between items. At 0 the items fuse into one segmented control.",
  },
  {
    prop: "orientation",
    type: '"horizontal" | "vertical"',
    defaultValue: '"horizontal"',
    description: "Arrow-key navigation axis.",
  },
  {
    prop: "ToggleGroupItem value",
    type: "string",
    defaultValue: "—",
    description: "Identifies the item inside the group's value array.",
  },
] as const

export const metadata: Metadata = {
  title: "Toggle Group | Design System",
  description:
    "Documentation and visual variants for the Not A Wrapper ToggleGroup component.",
}

export default function ToggleGroupPage() {
  const toggleGroupSource = readComponentSource(
    "components/ui/toggle-group.tsx"
  )

  return (
    <DsPage>
      <DsPageHeader
        slug="toggle-group"
        title="Toggle Group"
        description="A set of Base UI toggles sharing pressed state, fused into a segmented control or spaced apart."
      />

      <DsSection
        id="single"
        title="Single"
        description="The default exclusive mode: pressing an item releases the others. With spacing 0 and the outline variant, the items merge into one bordered control."
      >
        <ComponentPreview code={singleCode} sourceCode={toggleGroupSource}>
          <ToggleGroup defaultValue={["left"]} variant="outline">
            <ToggleGroupItem value="left" aria-label="Align left">
              <RiAlignLeft />
            </ToggleGroupItem>
            <ToggleGroupItem value="center" aria-label="Align center">
              <RiAlignCenter />
            </ToggleGroupItem>
            <ToggleGroupItem value="right" aria-label="Align right">
              <RiAlignRight />
            </ToggleGroupItem>
          </ToggleGroup>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="multiple"
        title="Multiple"
        description="multiple lets several items stay pressed at once; a non-zero spacing keeps each item's own rounded shape."
      >
        <ComponentPreview code={multipleCode} sourceCode={toggleGroupSource}>
          <ToggleGroup multiple defaultValue={["bold", "italic"]} spacing={4}>
            <ToggleGroupItem value="bold" aria-label="Toggle bold">
              <RiBold />
            </ToggleGroupItem>
            <ToggleGroupItem value="italic" aria-label="Toggle italic">
              <RiItalic />
            </ToggleGroupItem>
            <ToggleGroupItem value="underline" aria-label="Toggle underline">
              <RiUnderline />
            </ToggleGroupItem>
          </ToggleGroup>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[24, 30, 12, 34]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI ToggleGroup props (disabled, loopFocus, render) are
          forwarded from the wrapper; items forward Base UI Toggle props.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
