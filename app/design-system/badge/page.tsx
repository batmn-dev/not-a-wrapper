import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Badge } from "@/components/ui/badge"
import type { Metadata } from "next"

const variantsCode = `import { Badge } from "@/components/ui/badge"

export function BadgeVariants() {
  return (
    <div className="flex items-center gap-3">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="destructive">Destructive</Badge>
    </div>
  )
}`

const statusCode = `import { Badge } from "@/components/ui/badge"

export function BadgeStatus() {
  return (
    <div className="flex items-center gap-3">
      <Badge variant="info">Info</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="danger">Danger</Badge>
      <Badge variant="neutral">Neutral</Badge>
    </div>
  )
}`

const apiRows = [
  {
    prop: "variant",
    type: '"default" | "secondary" | "destructive" | "outline" | "source" | "info" | "warning" | "success" | "danger" | "neutral"',
    defaultValue: '"default"',
    description:
      "Visual style. The info/warning/success/danger/neutral family is the soft-tint status language; source is the chat sources badge.",
  },
  {
    prop: "size",
    type: '"default" | "sm" | "md"',
    defaultValue: '"default"',
    description:
      "Fixed heights for status rows: sm is 20px, md is 25px, default hugs its padding.",
  },
  {
    prop: "render",
    type: "ReactElement | render function",
    defaultValue: "—",
    description: "Replaces the rendered element or composes another component.",
  },
] as const

export const metadata: Metadata = {
  title: "Badge | Design System",
  description:
    "Documentation and visual variants for the Not A Wrapper Badge component.",
}

export default function BadgePage() {
  const badgeSource = readComponentSource("components/ui/badge.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="badge"
        title="Badge"
        description="Compact label for counts, states, and categories, with a soft-tint status family."
      />

      <DsSection id="variants" title="Variants">
        <ComponentPreview code={variantsCode} sourceCode={badgeSource}>
          <div className="flex items-center gap-3">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="status"
        title="Status"
        description="The token-driven soft-tint family: a light fill, colored text, and a faint border in one visual language. failed/denied states share danger."
      >
        <ComponentPreview code={statusCode} sourceCode={badgeSource}>
          <div className="flex items-center gap-3">
            <Badge variant="info">Info</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="danger">Danger</Badge>
            <Badge variant="neutral">Neutral</Badge>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[14, 40, 12, 34]} rows={apiRows} />
        <DsParagraph className="mt-3">
          All standard span attributes are forwarded to the rendered element.
          Nested svg icons are sized to 12px automatically.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
