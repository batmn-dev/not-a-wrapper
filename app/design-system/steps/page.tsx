import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import {
  Steps,
  StepsContent,
  StepsItem,
  StepsTrigger,
} from "@/components/ui/steps"
import { RiSearchLine } from "@remixicon/react"
import type { Metadata } from "next"

const defaultCode = `import {
  Steps,
  StepsContent,
  StepsItem,
  StepsTrigger,
} from "@/components/ui/steps"

export function StepsDefault() {
  return (
    <Steps className="w-72">
      <StepsTrigger>Thought for 12 seconds</StepsTrigger>
      <StepsContent>
        <StepsItem>Reading the request and gathering context.</StepsItem>
        <StepsItem>Comparing the two candidate approaches.</StepsItem>
        <StepsItem>Drafting the final answer.</StepsItem>
      </StepsContent>
    </Steps>
  )
}`

const leftIconCode = `import {
  Steps,
  StepsContent,
  StepsItem,
  StepsTrigger,
} from "@/components/ui/steps"
import { RiSearchLine } from "@remixicon/react"

export function StepsLeftIcon() {
  return (
    <Steps className="w-72" defaultOpen={false}>
      <StepsTrigger leftIcon={<RiSearchLine className="size-4" />}>
        Searched the web
      </StepsTrigger>
      <StepsContent>
        <StepsItem>3 results for &quot;embla carousel react&quot;</StepsItem>
        <StepsItem>Reading embla-carousel.com</StepsItem>
      </StepsContent>
    </Steps>
  )
}`

const apiRows = [
  {
    prop: "Steps defaultOpen",
    type: "boolean",
    defaultValue: "true",
    description:
      "Initial open state when uncontrolled; open/onOpenChange forward for controlled use.",
  },
  {
    prop: "StepsTrigger leftIcon",
    type: "ReactNode",
    defaultValue: "—",
    description:
      "Glyph before the label. When set, the trailing chevron moves into this slot.",
  },
  {
    prop: "StepsTrigger swapIconOnHover",
    type: "boolean",
    defaultValue: "true",
    description:
      "Crossfades leftIcon into the expand chevron while the trigger is hovered.",
  },
  {
    prop: "StepsContent bar",
    type: "ReactNode",
    defaultValue: "<StepsBar />",
    description:
      "The vertical rule beside the step list; pass a custom node to replace it.",
  },
  {
    prop: "StepsItem",
    type: "div props",
    defaultValue: "—",
    description: "One muted-text row inside the content column.",
  },
] as const

export const metadata: Metadata = {
  title: "Steps | Design System",
  description:
    "Collapsible step list for reasoning and tool activity, with a vertical progress rule.",
}

export default function StepsPage() {
  const stepsSource = readComponentSource("components/ui/steps.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="steps"
        title="Steps"
        description="Collapsible step list built on Collapsible: a muted trigger line that expands into items beside a vertical rule, used for reasoning and tool activity."
      />

      <DsSection
        id="default"
        title="Default"
        description="Without a leftIcon the chevron trails the label and rotates when open. Content animates open and closed via the collapsible keyframes."
      >
        <ComponentPreview code={defaultCode} sourceCode={stepsSource}>
          <Steps className="w-72">
            <StepsTrigger>Thought for 12 seconds</StepsTrigger>
            <StepsContent>
              <StepsItem>Reading the request and gathering context.</StepsItem>
              <StepsItem>Comparing the two candidate approaches.</StepsItem>
              <StepsItem>Drafting the final answer.</StepsItem>
            </StepsContent>
          </Steps>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="left-icon"
        title="Leading icon"
        description="With leftIcon the glyph leads the label and, by default, crossfades into the expand chevron on hover."
      >
        <ComponentPreview code={leftIconCode} sourceCode={stepsSource}>
          <Steps className="w-72" defaultOpen={false}>
            <StepsTrigger leftIcon={<RiSearchLine className="size-4" />}>
              Searched the web
            </StepsTrigger>
            <StepsContent>
              <StepsItem>3 results for &quot;embla carousel react&quot;</StepsItem>
              <StepsItem>Reading embla-carousel.com</StepsItem>
            </StepsContent>
          </Steps>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[28, 18, 16, 38]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Steps forwards all Base UI Collapsible props; StepsTrigger and
          StepsContent forward CollapsibleTrigger and CollapsibleContent props.
          StepsBar is exported for custom rules.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
