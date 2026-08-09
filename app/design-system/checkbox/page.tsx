import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import type { Metadata } from "next"

const defaultCode = `import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

export function CheckboxDefault() {
  return (
    <div className="grid gap-4">
      <Label>
        <Checkbox defaultChecked />
        Accept terms and conditions
      </Label>
      <Label>
        <Checkbox />
        Email me product updates
      </Label>
      <Label>
        <Checkbox disabled />
        Disabled option
      </Label>
    </div>
  )
}`

const apiRows = [
  {
    prop: "defaultChecked",
    type: "boolean",
    defaultValue: "false",
    description: "Initial checked state when uncontrolled.",
  },
  {
    prop: "checked / onCheckedChange",
    type: "boolean / (checked, event) => void",
    defaultValue: "—",
    description: "Controlled checked state and its change handler.",
  },
  {
    prop: "indeterminate",
    type: "boolean",
    defaultValue: "false",
    description: "Shows the mixed state for partially-selected groups.",
  },
  {
    prop: "disabled",
    type: "boolean",
    defaultValue: "false",
    description: "Prevents interaction and dims the checkbox.",
  },
  {
    prop: "name / value",
    type: "string / string",
    defaultValue: "—",
    description: "Identify the checkbox when submitting a form.",
  },
] as const

export const metadata: Metadata = {
  title: "Checkbox | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Checkbox component.",
}

export default function CheckboxPage() {
  const checkboxSource = readComponentSource("components/ui/checkbox.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="checkbox"
        title="Checkbox"
        description="Base UI checkbox with the shared input surface, an extended hit area, and built-in Label pairing."
      />

      <DsSection
        id="default"
        title="Default"
        description="Wrap in a Label for an implicit association, or pair with htmlFor and an id. The invisible after: inset extends the hit area beyond the 16px box."
      >
        <ComponentPreview code={defaultCode} sourceCode={checkboxSource}>
          <div className="grid gap-4">
            <Label>
              <Checkbox defaultChecked />
              Accept terms and conditions
            </Label>
            <Label>
              <Checkbox />
              Email me product updates
            </Label>
            <Label>
              <Checkbox disabled />
              Disabled option
            </Label>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[24, 28, 12, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Checkbox.Root props are forwarded, including
          required and inputRef for form integration.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
