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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Metadata } from "next"

const usageCode = `import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function LabelUsage() {
  return (
    <div className="grid w-64 gap-6">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="Ada Lovelace" />
      </div>
      <Label>
        <Checkbox defaultChecked />
        Accept terms and conditions
      </Label>
    </div>
  )
}`

const disabledCode = `import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

export function LabelDisabled() {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id="disabled-option" disabled />
      <Label htmlFor="disabled-option">Disabled option</Label>
    </div>
  )
}`

const apiRows = [
  {
    prop: "htmlFor",
    type: "string",
    defaultValue: "—",
    description:
      "Associates the label with a control by id. Omit it and wrap the control as a child instead for implicit association.",
  },
  {
    prop: "children",
    type: "ReactNode",
    defaultValue: "—",
    description:
      "Label text, optionally alongside a wrapped control. The label lays out as a flex row with gap-2.",
  },
] as const

export const metadata: Metadata = {
  title: "Label | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Label component.",
}

export default function LabelPage() {
  const labelSource = readComponentSource("components/ui/label.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="label"
        title="Label"
        description="Form label that associates with a control via htmlFor or by wrapping it, and dims itself when its control is disabled."
      />

      <DsSection
        id="usage"
        title="Usage"
        description="Reference a control by id with htmlFor, or wrap the control directly — the built-in flex row and gap handle the layout."
      >
        <ComponentPreview code={usageCode} sourceCode={labelSource}>
          <div className="grid w-64 gap-6">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="Ada Lovelace" />
            </div>
            <Label>
              <Checkbox defaultChecked />
              Accept terms and conditions
            </Label>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="disabled"
        title="Disabled"
        description="Controls in ui/ carry the peer class, so a Label placed after a disabled sibling control dims and blocks its cursor automatically."
      >
        <ComponentPreview code={disabledCode} sourceCode={labelSource}>
          <div className="flex items-center gap-2">
            <Checkbox id="disabled-option" disabled />
            <Label htmlFor="disabled-option">Disabled option</Label>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[16, 20, 12, 52]} rows={apiRows} />
        <DsParagraph className="mt-3">
          All standard label attributes are forwarded to the rendered element.
          Disabled styling reacts to peer-disabled, peer-data-disabled, and
          group-data-[disabled=true] hooks from neighboring controls.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
