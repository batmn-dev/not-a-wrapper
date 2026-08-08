import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Progress } from "@/components/ui/progress"
import type { Metadata } from "next"

const defaultCode = `import { Progress } from "@/components/ui/progress"

export function ProgressDefault() {
  return (
    <div className="flex w-64 flex-col gap-6">
      <Progress value={25} />
      <Progress value={60} />
      <Progress value={90} />
    </div>
  )
}`

const apiRows = [
  {
    prop: "value",
    type: "number | null",
    defaultValue: "null",
    description:
      "Current progress from 0 to max. null renders the indeterminate ARIA state; the bar treats it as 0.",
  },
  {
    prop: "max",
    type: "number",
    defaultValue: "100",
    description: "Value at which the task is complete.",
  },
  {
    prop: "className",
    type: "string",
    defaultValue: "—",
    description:
      "Applied to the track — use it to size the bar or recolor the background.",
  },
] as const

export const metadata: Metadata = {
  title: "Progress | Design System",
  description:
    "Base UI progress bar with a rounded track and a translating primary indicator.",
}

export default function ProgressPage() {
  const progressSource = readComponentSource("components/ui/progress.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="progress"
        title="Progress"
        description="A determinate progress bar built on the Base UI Progress primitive, with correct ARIA progressbar semantics."
      />

      <DsSection
        id="default"
        title="Default"
        description="The indicator slides across the track proportionally to value. The transition on the indicator animates changes between renders."
      >
        <ComponentPreview code={defaultCode} sourceCode={progressSource}>
          <div className="flex w-64 flex-col gap-6">
            <Progress value={25} />
            <Progress value={60} />
            <Progress value={90} />
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[16, 24, 12, 48]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Progress root props (format, locale,
          getAriaValueText) are forwarded. The track and indicator are internal
          — the wrapper exposes a single-element API.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
