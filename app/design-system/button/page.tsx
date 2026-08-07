import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Button } from "@/components/ui/button"
import type { Metadata } from "next"

const variantsCode = `import { Button } from "@/components/ui/button"

export function ButtonVariants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button">Default</Button>
      <Button type="button" variant="outline">Outline</Button>
      <Button type="button" variant="secondary">Secondary</Button>
      <Button type="button" variant="ghost">Ghost</Button>
      <Button type="button" variant="destructive">Destructive</Button>
      <Button type="button" variant="link">Link</Button>
    </div>
  )
}`

const apiRows = [
  {
    prop: "variant",
    type: '"default" | "outline" | "secondary" | "ghost" | "destructive" | "link"',
    defaultValue: '"default"',
    description: "Visual style of the button.",
  },
  {
    prop: "size",
    type: '"default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"',
    defaultValue: '"default"',
    description: "Size of the button.",
  },
  {
    prop: "render",
    type: "ReactElement | render function",
    defaultValue: "—",
    description: "Replaces the rendered element or composes another component.",
  },
  {
    prop: "disabled",
    type: "boolean",
    defaultValue: "false",
    description: "Prevents interaction with the button.",
  },
] as const

export const metadata: Metadata = {
  title: "Button | Design System",
  description:
    "Documentation and visual variants for the Not A Wrapper Button component.",
}

export default function ButtonPage() {
  const buttonSource = readComponentSource("components/ui/button.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="button"
        title="Button"
        description="Versatile button with visual variants, multiple sizes, and custom render support."
      />

      <DsSection id="variants" title="Variants">
        <ComponentPreview code={variantsCode} sourceCode={buttonSource}>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button">Default</Button>
            <Button type="button" variant="outline">
              Outline
            </Button>
            <Button type="button" variant="secondary">
              Secondary
            </Button>
            <Button type="button" variant="ghost">
              Ghost
            </Button>
            <Button type="button" variant="destructive">
              Destructive
            </Button>
            <Button type="button" variant="link">
              Link
            </Button>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[14, 34, 16, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          All standard button attributes and Base UI Button props are forwarded
          to the rendered element.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
