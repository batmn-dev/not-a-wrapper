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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { Metadata } from "next"

const defaultCode = `import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

export function CollapsibleDefault() {
  return (
    <Collapsible defaultOpen className="flex w-72 flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <h4 className="text-sm font-medium">Pinned dependencies</h4>
        <CollapsibleTrigger className="text-muted-foreground text-sm hover:underline">
          Toggle
        </CollapsibleTrigger>
      </div>
      <div className="rounded-md border px-4 py-2 font-mono text-xs">
        @base-ui/react
      </div>
      <CollapsibleContent className="flex flex-col gap-2">
        <div className="rounded-md border px-4 py-2 font-mono text-xs">
          @remixicon/react
        </div>
        <div className="rounded-md border px-4 py-2 font-mono text-xs">
          class-variance-authority
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}`

const apiRows = [
  {
    prop: "defaultOpen",
    type: "boolean",
    defaultValue: "false",
    description: "Whether the panel starts open when uncontrolled.",
  },
  {
    prop: "open / onOpenChange",
    type: "boolean / (open) => void",
    defaultValue: "—",
    description:
      "Controlled open state and its change handler, on the Collapsible root.",
  },
  {
    prop: "disabled",
    type: "boolean",
    defaultValue: "false",
    description:
      "Prevents toggling. The trigger picks up the not-allowed cursor.",
  },
  {
    prop: "CollapsibleContent keepMounted",
    type: "boolean",
    defaultValue: "false",
    description: "Keeps the panel in the DOM while closed.",
  },
] as const

export const metadata: Metadata = {
  title: "Collapsible | Design System",
  description:
    "Base UI collapsible primitive for showing and hiding a single panel of content.",
}

export default function CollapsiblePage() {
  const collapsibleSource = readComponentSource("components/ui/collapsible.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="collapsible"
        title="Collapsible"
        description="An unstyled show/hide primitive built on Base UI Collapsible — the single-panel sibling of Accordion."
      />

      <DsSection
        id="default"
        title="Default"
        description="The wrapper only adds cursor affordances; layout and styling belong to the caller. Content outside CollapsibleContent stays visible while the panel toggles."
      >
        <ComponentPreview code={defaultCode} sourceCode={collapsibleSource}>
          <Collapsible defaultOpen className="flex w-72 flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <h4 className="text-sm font-medium">Pinned dependencies</h4>
              <CollapsibleTrigger className="text-muted-foreground text-sm hover:underline">
                Toggle
              </CollapsibleTrigger>
            </div>
            <div className="rounded-md border px-4 py-2 font-mono text-xs">
              @base-ui/react
            </div>
            <CollapsibleContent className="flex flex-col gap-2">
              <div className="rounded-md border px-4 py-2 font-mono text-xs">
                @remixicon/react
              </div>
              <div className="rounded-md border px-4 py-2 font-mono text-xs">
                class-variance-authority
              </div>
            </CollapsibleContent>
          </Collapsible>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[28, 24, 10, 38]} rows={apiRows} />
        <DsParagraph className="mt-3">
          All remaining Base UI Collapsible props (className, render, and
          state-driven data attributes like data-open and data-closed) are
          forwarded from each wrapper.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
