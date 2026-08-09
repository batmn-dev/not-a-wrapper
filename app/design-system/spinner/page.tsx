import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Spinner } from "@/components/ui/spinner"
import type { Metadata } from "next"

const sizesCode = `import { Spinner } from "@/components/ui/spinner"

export function SpinnerSizes() {
  return (
    <div className="flex items-center gap-6">
      <Spinner />
      <Spinner slotSize={24} />
      <Spinner slotSize={32} className="text-muted-foreground" />
    </div>
  )
}`

const apiRows = [
  {
    prop: "slotSize",
    type: "number | string",
    defaultValue: "16",
    description:
      "Size of the square icon slot; numbers are treated as pixels. The glyph fills the slot minus the glyph inset.",
  },
  {
    prop: "glyphSize / glyphInset",
    type: "number | string",
    defaultValue: "—",
    description:
      "Override the spinning glyph's size directly, or the inset it keeps from the slot edge.",
  },
  {
    prop: "className",
    type: "string",
    defaultValue: "—",
    description:
      "Merged onto the slot span; the spinner inherits its color from text color.",
  },
  {
    prop: "aria-label",
    type: "string",
    defaultValue: '"Loading"',
    description:
      "Announced status text. The spinner ships with role=status so it is never decorative.",
  },
] as const

export const metadata: Metadata = {
  title: "Spinner | Design System",
  description:
    "Documentation and usage for the Not A Wrapper Spinner component.",
}

export default function SpinnerPage() {
  const spinnerSource = readComponentSource("components/ui/spinner.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="spinner"
        title="Spinner"
        description="Spinning loader built on the Icon slot system, announced to assistive tech as a loading status."
      />

      <DsSection
        id="sizes"
        title="Sizes"
        description="The spinner inherits the surrounding text color and scales through the Icon slot, so it aligns with any icon of the same slot size."
      >
        <ComponentPreview code={sizesCode} sourceCode={spinnerSource}>
          <div className="flex items-center gap-6">
            <Spinner />
            <Spinner slotSize={24} />
            <Spinner slotSize={32} className="text-muted-foreground" />
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[22, 20, 14, 44]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Spinner accepts every Icon prop except icon itself, which is fixed to
          the loader glyph.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
