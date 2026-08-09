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
import { Textarea } from "@/components/ui/textarea"
import type { Metadata } from "next"

const defaultCode = `import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function TextareaDefault() {
  return (
    <div className="grid w-64 gap-2">
      <Label htmlFor="message">Message</Label>
      <Textarea id="message" placeholder="Type your message here." />
    </div>
  )
}`

const statesCode = `import { Textarea } from "@/components/ui/textarea"

export function TextareaStates() {
  return (
    <div className="grid w-64 gap-4">
      <Textarea placeholder="Disabled" disabled />
      <Textarea defaultValue="Invalid value" aria-invalid />
    </div>
  )
}`

const apiRows = [
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
  {
    prop: "rows",
    type: "number",
    defaultValue: "—",
    description:
      "Optional minimum row count; the field already auto-grows with content via field-sizing.",
  },
] as const

export const metadata: Metadata = {
  title: "Textarea | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Textarea component.",
}

export default function TextareaPage() {
  const textareaSource = readComponentSource("components/ui/textarea.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="textarea"
        title="Textarea"
        description="Multi-line text field that auto-grows with its content, sharing the Input's shadow-border and focus-ring treatment."
      />

      <DsSection
        id="default"
        title="Default"
        description="Starts at min-h-20 and grows with content (field-sizing-content), so no resize handle or rows tuning is needed."
      >
        <ComponentPreview code={defaultCode} sourceCode={textareaSource}>
          <div className="grid w-64 gap-2">
            <Label htmlFor="message">Message</Label>
            <Textarea id="message" placeholder="Type your message here." />
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="states"
        title="States"
        description="disabled dims the field and blocks interaction; aria-invalid swaps in the destructive border and ring."
      >
        <ComponentPreview code={statesCode} sourceCode={textareaSource}>
          <div className="grid w-64 gap-4">
            <Textarea placeholder="Disabled" disabled />
            <Textarea defaultValue="Invalid value" aria-invalid />
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[18, 22, 14, 46]} rows={apiRows} />
        <DsParagraph className="mt-3">
          All standard textarea attributes are forwarded to the rendered
          element.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
