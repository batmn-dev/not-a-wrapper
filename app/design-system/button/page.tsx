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
import { RiAddLine, RiArrowRightLine } from "@remixicon/react"
import type { Metadata } from "next"

const variantsCode = `import { Button } from "@/components/ui/button"
import { RiAddLine, RiArrowRightLine } from "@remixicon/react"

export function ButtonVariants() {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex items-center gap-6">
        <Button type="button">
          <RiAddLine data-icon="inline-start" />
          Default
          <RiArrowRightLine data-icon="inline-end" />
        </Button>
        <Button type="button" variant="outline">
          <RiAddLine data-icon="inline-start" />
          Outline
          <RiArrowRightLine data-icon="inline-end" />
        </Button>
        <Button type="button" variant="secondary">
          <RiAddLine data-icon="inline-start" />
          Secondary
          <RiArrowRightLine data-icon="inline-end" />
        </Button>
      </div>
      <div className="flex items-center gap-6">
        <Button type="button" variant="ghost">
          <RiAddLine data-icon="inline-start" />
          Ghost
          <RiArrowRightLine data-icon="inline-end" />
        </Button>
        <Button type="button" variant="destructive">
          <RiAddLine data-icon="inline-start" />
          Destructive
          <RiArrowRightLine data-icon="inline-end" />
        </Button>
        <Button type="button" variant="link">
          <RiAddLine data-icon="inline-start" />
          Link
          <RiArrowRightLine data-icon="inline-end" />
        </Button>
      </div>
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
          <div className="flex flex-col items-center gap-6">
            <div className="flex items-center gap-6">
              <Button type="button">
                <RiAddLine data-icon="inline-start" />
                Default
                <RiArrowRightLine data-icon="inline-end" />
              </Button>
              <Button type="button" variant="outline">
                <RiAddLine data-icon="inline-start" />
                Outline
                <RiArrowRightLine data-icon="inline-end" />
              </Button>
              <Button type="button" variant="secondary">
                <RiAddLine data-icon="inline-start" />
                Secondary
                <RiArrowRightLine data-icon="inline-end" />
              </Button>
            </div>
            <div className="flex items-center gap-6">
              <Button type="button" variant="ghost">
                <RiAddLine data-icon="inline-start" />
                Ghost
                <RiArrowRightLine data-icon="inline-end" />
              </Button>
              <Button type="button" variant="destructive">
                <RiAddLine data-icon="inline-start" />
                Destructive
                <RiArrowRightLine data-icon="inline-end" />
              </Button>
              <Button type="button" variant="link">
                <RiAddLine data-icon="inline-start" />
                Link
                <RiArrowRightLine data-icon="inline-end" />
              </Button>
            </div>
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
