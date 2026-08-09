import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { Metadata } from "next"

const defaultCode = `import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

export function RadioGroupDefault() {
  return (
    <RadioGroup defaultValue="comfortable" className="w-56">
      <Label>
        <RadioGroupItem value="default" />
        Default
      </Label>
      <Label>
        <RadioGroupItem value="comfortable" />
        Comfortable
      </Label>
      <Label>
        <RadioGroupItem value="compact" />
        Compact
      </Label>
    </RadioGroup>
  )
}`

const apiRows = [
  {
    prop: "defaultValue",
    type: "unknown",
    defaultValue: "—",
    description: "Initially selected item value when uncontrolled.",
  },
  {
    prop: "value / onValueChange",
    type: "unknown / (value, event) => void",
    defaultValue: "—",
    description:
      "Controlled selected value and its change handler, on the RadioGroup root.",
  },
  {
    prop: "disabled",
    type: "boolean",
    defaultValue: "false",
    description:
      "Disables the whole group; also available per item on RadioGroupItem.",
  },
  {
    prop: "name",
    type: "string",
    defaultValue: "—",
    description: "Identifies the group when submitting a form.",
  },
  {
    prop: "RadioGroupItem value",
    type: "unknown",
    defaultValue: "—",
    description: "Value this item contributes when selected. Required.",
  },
] as const

export const metadata: Metadata = {
  title: "Radio Group | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Radio Group component.",
}

export default function RadioGroupPage() {
  const radioGroupSource = readComponentSource("components/ui/radio-group.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="radio-group"
        title="Radio Group"
        description="Base UI radio group for single-choice selection, laid out as a vertical grid with the shared input surface on each item."
      />

      <DsSection
        id="default"
        title="Default"
        description="Wrap each RadioGroupItem in a Label for an implicit association. The root stacks items in a grid with gap-3; arrow keys move the selection."
      >
        <ComponentPreview code={defaultCode} sourceCode={radioGroupSource}>
          <RadioGroup defaultValue="comfortable" className="w-56">
            <Label>
              <RadioGroupItem value="default" />
              Default
            </Label>
            <Label>
              <RadioGroupItem value="comfortable" />
              Comfortable
            </Label>
            <Label>
              <RadioGroupItem value="compact" />
              Compact
            </Label>
          </RadioGroup>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[24, 28, 12, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI RadioGroup and Radio.Root props are forwarded from
          the RadioGroup and RadioGroupItem wrappers respectively.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
