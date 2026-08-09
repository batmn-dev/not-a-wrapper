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
import {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
} from "@/components/ui/button-group"
import { RiArrowDownLine, RiArrowUpLine, RiStarLine } from "@remixicon/react"
import type { Metadata } from "next"

const defaultCode = `import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"

export function ButtonGroupDefault() {
  return (
    <ButtonGroup>
      <Button type="button" variant="outline">Copy</Button>
      <Button type="button" variant="outline">Paste</Button>
      <Button type="button" variant="outline">Cut</Button>
    </ButtonGroup>
  )
}`

const textCode = `import { Button } from "@/components/ui/button"
import {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
} from "@/components/ui/button-group"
import { RiStarLine } from "@remixicon/react"

export function ButtonGroupTextAndSeparator() {
  return (
    <ButtonGroup>
      <ButtonGroupText>
        <RiStarLine />
        Rating
      </ButtonGroupText>
      <Button type="button" variant="secondary">Upvote</Button>
      <ButtonGroupSeparator />
      <Button type="button" variant="secondary">Downvote</Button>
    </ButtonGroup>
  )
}`

const verticalCode = `import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { RiArrowDownLine, RiArrowUpLine } from "@remixicon/react"

export function ButtonGroupVertical() {
  return (
    <ButtonGroup orientation="vertical">
      <Button type="button" variant="outline" size="icon" aria-label="Move up">
        <RiArrowUpLine />
      </Button>
      <Button type="button" variant="outline" size="icon" aria-label="Move down">
        <RiArrowDownLine />
      </Button>
    </ButtonGroup>
  )
}`

const apiRows = [
  {
    prop: "orientation",
    type: '"horizontal" | "vertical"',
    defaultValue: '"horizontal"',
    description:
      "Stacking axis. Collapses the inner corner radii and shared borders along that axis.",
  },
  {
    prop: "ButtonGroupText render",
    type: "ReactElement | render function",
    defaultValue: "—",
    description:
      "Replaces the rendered element or composes another component, e.g. a label.",
  },
  {
    prop: "ButtonGroupSeparator orientation",
    type: '"horizontal" | "vertical"',
    defaultValue: '"vertical"',
    description: 'Separator axis; use "horizontal" inside vertical groups.',
  },
] as const

export const metadata: Metadata = {
  title: "Button Group | Design System",
  description:
    "Documentation and visual variants for the Not A Wrapper ButtonGroup component.",
}

export default function ButtonGroupPage() {
  const buttonGroupSource = readComponentSource(
    "components/ui/button-group.tsx"
  )

  return (
    <DsPage>
      <DsPageHeader
        slug="button-group"
        title="Button Group"
        description="Joins buttons, text, and form controls into a single segmented control with shared borders."
      />

      <DsSection
        id="default"
        title="Default"
        description="Adjacent data-slot children lose their inner radii and duplicate borders, so outline buttons read as one control."
      >
        <ComponentPreview code={defaultCode} sourceCode={buttonGroupSource}>
          <ButtonGroup>
            <Button type="button" variant="outline">
              Copy
            </Button>
            <Button type="button" variant="outline">
              Paste
            </Button>
            <Button type="button" variant="outline">
              Cut
            </Button>
          </ButtonGroup>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="text-and-separator"
        title="Text and separator"
        description="ButtonGroupText labels a segment without being interactive; ButtonGroupSeparator draws an explicit divider between borderless segments like secondary buttons."
      >
        <ComponentPreview code={textCode} sourceCode={buttonGroupSource}>
          <ButtonGroup>
            <ButtonGroupText>
              <RiStarLine />
              Rating
            </ButtonGroupText>
            <Button type="button" variant="secondary">
              Upvote
            </Button>
            <ButtonGroupSeparator />
            <Button type="button" variant="secondary">
              Downvote
            </Button>
          </ButtonGroup>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="vertical"
        title="Vertical"
        description={
          'orientation="vertical" stacks the segments and collapses the shared horizontal edges instead.'
        }
      >
        <ComponentPreview code={verticalCode} sourceCode={buttonGroupSource}>
          <ButtonGroup orientation="vertical">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Move up"
            >
              <RiArrowUpLine />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Move down"
            >
              <RiArrowDownLine />
            </Button>
          </ButtonGroup>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 26, 14, 34]} rows={apiRows} />
        <DsParagraph className="mt-3">
          ButtonGroup renders a plain div with role=&quot;group&quot; and
          forwards all div attributes. Sibling button groups nested inside a
          group are spaced apart with a gap instead of being merged.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
