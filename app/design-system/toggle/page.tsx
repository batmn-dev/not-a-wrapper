import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Toggle } from "@/components/ui/toggle"
import { RiBold, RiItalic, RiUnderline } from "@remixicon/react"
import type { Metadata } from "next"

const variantsCode = `import { Toggle } from "@/components/ui/toggle"
import { RiBold, RiItalic } from "@remixicon/react"

export function ToggleVariants() {
  return (
    <div className="flex items-center gap-6">
      <Toggle aria-label="Toggle bold" defaultPressed>
        <RiBold />
      </Toggle>
      <Toggle aria-label="Toggle italic" variant="outline">
        <RiItalic />
        Italic
      </Toggle>
    </div>
  )
}`

const sizesCode = `import { Toggle } from "@/components/ui/toggle"
import { RiUnderline } from "@remixicon/react"

export function ToggleSizes() {
  return (
    <div className="flex items-center gap-6">
      <Toggle aria-label="Toggle underline" variant="outline" size="sm">
        <RiUnderline />
      </Toggle>
      <Toggle aria-label="Toggle underline" variant="outline">
        <RiUnderline />
      </Toggle>
      <Toggle aria-label="Toggle underline" variant="outline" size="lg">
        <RiUnderline />
      </Toggle>
    </div>
  )
}`

const apiRows = [
  {
    prop: "variant",
    type: '"default" | "outline"',
    defaultValue: '"default"',
    description: "Transparent toggle or bordered toggle with a shadow.",
  },
  {
    prop: "size",
    type: '"default" | "sm" | "lg"',
    defaultValue: '"default"',
    description: "Height and horizontal padding of the toggle.",
  },
  {
    prop: "pressed / onPressedChange",
    type: "boolean / (pressed, details) => void",
    defaultValue: "—",
    description: "Controlled pressed state and its change handler.",
  },
  {
    prop: "defaultPressed",
    type: "boolean",
    defaultValue: "false",
    description: "Initial pressed state when uncontrolled.",
  },
  {
    prop: "value",
    type: "string",
    defaultValue: "—",
    description: "Identifies the toggle when rendered inside a ToggleGroup.",
  },
  {
    prop: "disabled",
    type: "boolean",
    defaultValue: "false",
    description: "Prevents interaction with the toggle.",
  },
] as const

export const metadata: Metadata = {
  title: "Toggle | Design System",
  description:
    "Documentation and visual variants for the Not A Wrapper Toggle component.",
}

export default function TogglePage() {
  const toggleSource = readComponentSource("components/ui/toggle.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="toggle"
        title="Toggle"
        description="Base UI two-state button that reflects its pressed state through the interactive tint tokens."
      />

      <DsSection
        id="variants"
        title="Variants"
        description="The default variant is transparent at rest and tints when pressed; outline adds a border and shadow for standalone placement."
      >
        <ComponentPreview code={variantsCode} sourceCode={toggleSource}>
          <div className="flex items-center gap-6">
            <Toggle aria-label="Toggle bold" defaultPressed>
              <RiBold />
            </Toggle>
            <Toggle aria-label="Toggle italic" variant="outline">
              <RiItalic />
              Italic
            </Toggle>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="sizes" title="Sizes">
        <ComponentPreview code={sizesCode} sourceCode={toggleSource}>
          <div className="flex items-center gap-6">
            <Toggle aria-label="Toggle underline" variant="outline" size="sm">
              <RiUnderline />
            </Toggle>
            <Toggle aria-label="Toggle underline" variant="outline">
              <RiUnderline />
            </Toggle>
            <Toggle aria-label="Toggle underline" variant="outline" size="lg">
              <RiUnderline />
            </Toggle>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 28, 12, 34]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Toggle props (render, native button attributes) are
          forwarded to the rendered button element.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
