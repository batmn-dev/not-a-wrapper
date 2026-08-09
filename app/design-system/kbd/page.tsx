import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import type { Metadata } from "next"

const usageCode = `import { Kbd, KbdGroup } from "@/components/ui/kbd"

export function KbdDemo() {
  return (
    <div className="flex flex-col items-center gap-4">
      <KbdGroup>
        <Kbd label="Command">⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
      <p className="text-muted-foreground text-sm">
        Press{" "}
        <KbdGroup>
          <Kbd label="Shift">⇧</Kbd> <Kbd label="Enter">⏎</Kbd>
        </KbdGroup>{" "}
        for a new line
      </p>
    </div>
  )
}`

const apiRows = [
  {
    prop: "Kbd children",
    type: "ReactNode",
    defaultValue: "—",
    description: "The key cap text or symbol to display.",
  },
  {
    prop: "Kbd label",
    type: "string",
    defaultValue: "—",
    description:
      'Accessible name for symbol keys, e.g. label="Command" for the ⌘ glyph.',
  },
  {
    prop: "KbdGroup",
    type: "ReactNode children",
    defaultValue: "—",
    description:
      "Muted inline row for a full shortcut. Hidden on coarse pointers, where keyboard hints do not apply.",
  },
] as const

export const metadata: Metadata = {
  title: "Kbd | Design System",
  description: "Documentation and usage for the Not A Wrapper Kbd component.",
}

export default function KbdPage() {
  const kbdSource = readComponentSource("components/ui/kbd.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="kbd"
        title="Kbd"
        description="Semantic keyboard key indicator for shortcut hints, with a group wrapper that hides itself on touch devices."
      />

      <DsSection
        id="usage"
        title="Usage"
        description="Kbd renders a semantic kbd element with no chrome of its own; KbdGroup mutes and lays out a full shortcut."
      >
        <ComponentPreview code={usageCode} sourceCode={kbdSource}>
          <div className="flex flex-col items-center gap-4">
            <KbdGroup>
              <Kbd label="Command">⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
            <p className="text-muted-foreground text-sm">
              Press{" "}
              <KbdGroup>
                <Kbd label="Shift">⇧</Kbd> <Kbd label="Enter">⏎</Kbd>
              </KbdGroup>{" "}
              for a new line
            </p>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[18, 24, 14, 44]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Both pieces also accept className. KbdGroup preserves whitespace
          between keys, so literal spaces in the markup become the key spacing.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
