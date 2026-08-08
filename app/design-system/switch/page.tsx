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
import { Switch } from "@/components/ui/switch"
import type { Metadata } from "next"

const defaultCode = `import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export function SwitchDefault() {
  return (
    <div className="grid gap-4">
      <Label>
        <Switch defaultChecked />
        Airplane mode
      </Label>
      <Label>
        <Switch />
        Wi-Fi
      </Label>
      <Label>
        <Switch disabled />
        Disabled option
      </Label>
    </div>
  )
}`

const sizesCode = `import { Switch } from "@/components/ui/switch"

export function SwitchSizes() {
  return (
    <div className="flex items-center gap-6">
      <Switch defaultChecked />
      <Switch size="sm" defaultChecked />
    </div>
  )
}`

const apiRows = [
  {
    prop: "size",
    type: '"default" | "sm"',
    defaultValue: '"default"',
    description: "Track and thumb size of the switch.",
  },
  {
    prop: "defaultChecked",
    type: "boolean",
    defaultValue: "false",
    description: "Initial on/off state when uncontrolled.",
  },
  {
    prop: "checked / onCheckedChange",
    type: "boolean / (checked, event) => void",
    defaultValue: "—",
    description: "Controlled on/off state and its change handler.",
  },
  {
    prop: "disabled",
    type: "boolean",
    defaultValue: "false",
    description: "Prevents interaction and dims the switch.",
  },
  {
    prop: "name",
    type: "string",
    defaultValue: "—",
    description: "Identifies the switch when submitting a form.",
  },
] as const

export const metadata: Metadata = {
  title: "Switch | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Switch component.",
}

export default function SwitchPage() {
  const switchSource = readComponentSource("components/ui/switch.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="switch"
        title="Switch"
        description="Base UI switch for on/off settings, with two sizes and an extended hit area around the track."
      />

      <DsSection
        id="default"
        title="Default"
        description="Wrap in a Label for an implicit association. The invisible after: inset extends the hit area beyond the track."
      >
        <ComponentPreview code={defaultCode} sourceCode={switchSource}>
          <div className="grid gap-4">
            <Label>
              <Switch defaultChecked />
              Airplane mode
            </Label>
            <Label>
              <Switch />
              Wi-Fi
            </Label>
            <Label>
              <Switch disabled />
              Disabled option
            </Label>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="sizes"
        title="Sizes"
        description="The sm size fits dense rows like table cells and popover menus; default is for settings surfaces."
      >
        <ComponentPreview code={sizesCode} sourceCode={switchSource}>
          <div className="flex items-center gap-6">
            <Switch defaultChecked />
            <Switch size="sm" defaultChecked />
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[24, 28, 14, 34]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Switch.Root props are forwarded, including required
          and inputRef for form integration.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
