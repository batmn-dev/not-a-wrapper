import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Slider } from "@/components/ui/slider"
import type { Metadata } from "next"

const defaultCode = `import { Slider } from "@/components/ui/slider"

export function SliderDefault() {
  return <Slider defaultValue={[40]} max={100} step={1} className="w-64" />
}`

const rangeCode = `import { Slider } from "@/components/ui/slider"

export function SliderRange() {
  return <Slider defaultValue={[25, 75]} max={100} step={1} className="w-64" />
}`

const apiRows = [
  {
    prop: "defaultValue",
    type: "number | number[]",
    defaultValue: "—",
    description:
      "Initial value when uncontrolled. Pass an array — the wrapper renders one thumb per entry.",
  },
  {
    prop: "value / onValueChange",
    type: "number | number[] / (value, data) => void",
    defaultValue: "—",
    description: "Controlled value and its change handler.",
  },
  {
    prop: "min / max",
    type: "number / number",
    defaultValue: "0 / 100",
    description: "Bounds of the slider range.",
  },
  {
    prop: "step",
    type: "number",
    defaultValue: "1",
    description: "Granularity the value snaps to while dragging.",
  },
  {
    prop: "orientation",
    type: '"horizontal" | "vertical"',
    defaultValue: '"horizontal"',
    description: "Layout axis; vertical sliders take a min-h-44 column.",
  },
  {
    prop: "disabled",
    type: "boolean",
    defaultValue: "false",
    description: "Prevents interaction and dims the slider.",
  },
] as const

export const metadata: Metadata = {
  title: "Slider | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Slider component.",
}

export default function SliderPage() {
  const sliderSource = readComponentSource("components/ui/slider.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="slider"
        title="Slider"
        description="Base UI slider for picking a value or range from a track, rendering one thumb per value in the array."
      />

      <DsSection
        id="default"
        title="Default"
        description="Single-thumb slider. Pass defaultValue as a one-entry array; the track fills from the start to the thumb."
      >
        <ComponentPreview code={defaultCode} sourceCode={sliderSource}>
          <Slider defaultValue={[40]} max={100} step={1} className="w-64" />
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="range"
        title="Range"
        description="Two values render two thumbs with the filled indicator between them. Thumb count follows the value array length."
      >
        <ComponentPreview code={rangeCode} sourceCode={sliderSource}>
          <Slider defaultValue={[25, 75]} max={100} step={1} className="w-64" />
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[22, 30, 12, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Slider.Root props are forwarded, including
          onValueCommitted for reacting only when a drag ends.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
