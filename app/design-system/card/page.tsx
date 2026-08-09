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
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { Metadata } from "next"

const defaultCode = `import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function CardDefault() {
  return (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Project settings</CardTitle>
        <CardDescription>Configure how this project behaves.</CardDescription>
        <CardAction>
          <Badge variant="neutral">Beta</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        Custom instructions apply to every chat in this project.
      </CardContent>
      <CardFooter>
        <Button type="button" size="sm">
          Save changes
        </Button>
      </CardFooter>
    </Card>
  )
}`

const smallCode = `import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function CardSmall() {
  return (
    <Card size="sm" className="w-64">
      <CardHeader>
        <CardTitle>Usage</CardTitle>
      </CardHeader>
      <CardContent>1,248 messages this month.</CardContent>
    </Card>
  )
}`

const apiRows = [
  {
    prop: "Card size",
    type: '"default" | "sm"',
    defaultValue: '"default"',
    description:
      "Density preset: default uses 24px padding and gaps, sm tightens both to 16px across every subcomponent.",
  },
  {
    prop: "CardHeader",
    type: "div props",
    defaultValue: "—",
    description:
      "Grid that seats title and description, and reserves a trailing column when a CardAction is present.",
  },
  {
    prop: "CardTitle / CardDescription",
    type: "div props",
    defaultValue: "—",
    description:
      "Heading-font title and muted description rows inside the header.",
  },
  {
    prop: "CardAction",
    type: "div props",
    defaultValue: "—",
    description:
      "Trailing header slot for a button or badge, aligned to the top-right of the header grid.",
  },
  {
    prop: "CardContent / CardFooter",
    type: "div props",
    defaultValue: "—",
    description:
      "Body and footer rows. Add border-t/border-b utilities to get matching separator padding.",
  },
] as const

export const metadata: Metadata = {
  title: "Card | Design System",
  description:
    "Documentation and visual variants for the Not A Wrapper Card component.",
}

export default function CardPage() {
  const cardSource = readComponentSource("components/ui/card.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="card"
        title="Card"
        description="Surface container with header, content, footer, and a trailing action slot, in two density presets."
      />

      <DsSection id="default" title="Default">
        <ComponentPreview code={defaultCode} sourceCode={cardSource}>
          <Card className="w-80">
            <CardHeader>
              <CardTitle>Project settings</CardTitle>
              <CardDescription>
                Configure how this project behaves.
              </CardDescription>
              <CardAction>
                <Badge variant="neutral">Beta</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              Custom instructions apply to every chat in this project.
            </CardContent>
            <CardFooter>
              <Button type="button" size="sm">
                Save changes
              </Button>
            </CardFooter>
          </Card>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="small"
        title="Small"
        description="The sm size tightens padding and gaps from 24px to 16px for dense surfaces like stat tiles and settings groups."
      >
        <ComponentPreview code={smallCode} sourceCode={cardSource}>
          <Card size="sm" className="w-64">
            <CardHeader>
              <CardTitle>Usage</CardTitle>
            </CardHeader>
            <CardContent>1,248 messages this month.</CardContent>
          </Card>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 18, 14, 42]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Every piece is a plain div and forwards its standard attributes. A
          full-bleed img placed first or last inside Card keeps the rounded
          corners automatically.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
