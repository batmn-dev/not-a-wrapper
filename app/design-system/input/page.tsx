import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Metadata } from "next"

const defaultCode = `import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function InputDefault() {
  return (
    <div className="grid w-64 gap-2">
      <Label htmlFor="email">Email</Label>
      <Input id="email" type="email" placeholder="you@example.com" />
    </div>
  )
}`

const statesCode = `import { Input } from "@/components/ui/input"

export function InputStates() {
  return (
    <div className="grid w-64 gap-4">
      <Input placeholder="Disabled" disabled />
      <Input defaultValue="Invalid value" aria-invalid />
    </div>
  )
}`

const apiRows = [
  {
    prop: "type",
    type: "string",
    defaultValue: '"text"',
    description:
      "Native input type. File inputs pick up the styled file: button.",
  },
  {
    prop: "placeholder",
    type: "string",
    defaultValue: "—",
    description: "Hint text shown while the field is empty.",
  },
  {
    prop: "disabled",
    type: "boolean",
    defaultValue: "false",
    description: "Prevents interaction and dims the field.",
  },
  {
    prop: "aria-invalid",
    type: "boolean",
    defaultValue: "—",
    description:
      "Switches the field to the destructive border and ring treatment.",
  },
] as const

export const metadata: Metadata = {
  title: "Input | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Input component.",
}

export default function InputPage() {
  const inputSource = readComponentSource("components/ui/input.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="input"
        title="Input"
        description="Single-line text field built on the Base UI Input primitive, with the shared shadow-border and focus-ring treatment."
      />

      <DsSection
        id="default"
        title="Default"
        description="Pair with a Label via htmlFor. The field stretches to its container, so size it from the parent."
      >
        <ComponentPreview code={defaultCode} sourceCode={inputSource}>
          <div className="grid w-64 gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="you@example.com" />
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="states"
        title="States"
        description="disabled dims the field and blocks interaction; aria-invalid swaps in the destructive border and ring."
      >
        <ComponentPreview code={statesCode} sourceCode={inputSource}>
          <div className="grid w-64 gap-4">
            <Input placeholder="Disabled" disabled />
            <Input defaultValue="Invalid value" aria-invalid />
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[18, 22, 14, 46]} rows={apiRows} />
        <DsParagraph className="mt-3">
          All standard input attributes and Base UI Input props are forwarded to
          the rendered element.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
