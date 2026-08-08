import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { AspectRatio } from "@/components/ui/aspect-ratio"
import type { Metadata } from "next"

const defaultCode = `import { AspectRatio } from "@/components/ui/aspect-ratio"

export function AspectRatioDefault() {
  return (
    <div className="w-64">
      <AspectRatio
        ratio={16 / 9}
        className="bg-muted text-muted-foreground flex items-center justify-center rounded-lg border font-mono text-sm"
      >
        16 / 9
      </AspectRatio>
    </div>
  )
}`

const apiRows = [
  {
    prop: "ratio",
    type: "number",
    defaultValue: "1",
    description:
      "Width-to-height ratio, e.g. 16 / 9. Applied as the CSS aspect-ratio property.",
  },
  {
    prop: "className",
    type: "string",
    defaultValue: "—",
    description: "Styles the ratio container itself.",
  },
  {
    prop: "style",
    type: "CSSProperties",
    defaultValue: "—",
    description:
      "Merged after the computed aspect-ratio, so explicit styles win.",
  },
] as const

export const metadata: Metadata = {
  title: "Aspect Ratio | Design System",
  description:
    "A div that locks its children to a fixed width-to-height ratio via the CSS aspect-ratio property.",
}

export default function AspectRatioPage() {
  const aspectRatioSource = readComponentSource(
    "components/ui/aspect-ratio.tsx"
  )

  return (
    <DsPage>
      <DsPageHeader
        slug="aspect-ratio"
        title="Aspect Ratio"
        description="Constrains content — images, video embeds, placeholders — to a fixed ratio using native CSS aspect-ratio, no primitive library involved."
      />

      <DsSection
        id="default"
        title="Default"
        description="The parent controls the width; the ratio derives the height. Give the container media or placeholder styling directly via className."
      >
        <ComponentPreview code={defaultCode} sourceCode={aspectRatioSource}>
          <div className="w-64">
            <AspectRatio
              ratio={16 / 9}
              className="bg-muted text-muted-foreground flex items-center justify-center rounded-lg border font-mono text-sm"
            >
              16 / 9
            </AspectRatio>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[16, 24, 12, 48]} rows={apiRows} />
        <DsParagraph className="mt-3">
          All other div attributes are forwarded. Unlike the Radix version,
          this renders a single element — no absolutely-positioned inner
          wrapper — so children participate in normal flow layout.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
