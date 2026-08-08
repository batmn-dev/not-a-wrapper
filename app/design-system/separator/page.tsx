import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Separator } from "@/components/ui/separator"
import type { Metadata } from "next"

const usageCode = `import { Separator } from "@/components/ui/separator"

export function SeparatorDemo() {
  return (
    <div className="w-64">
      <div className="space-y-1">
        <h4 className="text-sm font-medium">Design System</h4>
        <p className="text-muted-foreground text-sm">
          Reusable UI primitives.
        </p>
      </div>
      <Separator className="my-4" />
      <div className="flex h-5 items-center gap-4 text-sm">
        <div>Docs</div>
        <Separator orientation="vertical" />
        <div>Source</div>
        <Separator orientation="vertical" />
        <div>Tokens</div>
      </div>
    </div>
  )
}`

const apiRows = [
  {
    prop: "orientation",
    type: '"horizontal" | "vertical"',
    defaultValue: '"horizontal"',
    description:
      "Axis of the rule. Horizontal fills the available width at 1px tall; vertical fills the available height at 1px wide.",
  },
  {
    prop: "className",
    type: "string",
    defaultValue: "—",
    description:
      "Merged onto the rule; use it for spacing (my-4) or a custom color.",
  },
] as const

export const metadata: Metadata = {
  title: "Separator | Design System",
  description:
    "Documentation and usage for the Not A Wrapper Separator component.",
}

export default function SeparatorPage() {
  const separatorSource = readComponentSource("components/ui/separator.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="separator"
        title="Separator"
        description="Base UI separator that draws a 1px border-colored rule between content, horizontally or vertically."
      />

      <DsSection
        id="usage"
        title="Usage"
        description="Vertical separators size to their container, so give the row an explicit height."
      >
        <ComponentPreview code={usageCode} sourceCode={separatorSource}>
          <div className="w-64">
            <div className="space-y-1">
              <h4 className="text-sm font-medium">Design System</h4>
              <p className="text-muted-foreground text-sm">
                Reusable UI primitives.
              </p>
            </div>
            <Separator className="my-4" />
            <div className="flex h-5 items-center gap-4 text-sm">
              <div>Docs</div>
              <Separator orientation="vertical" />
              <div>Source</div>
              <Separator orientation="vertical" />
              <div>Tokens</div>
            </div>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[16, 30, 16, 38]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Separator props are forwarded, so the rule stays
          accessible as a semantic separator by default.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
