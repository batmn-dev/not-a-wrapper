import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Metadata } from "next"

const releaseNotes = [
  "v0.9.0 — Durable turn runtime",
  "v0.8.2 — Streaming renderer fixes",
  "v0.8.1 — Sidebar row system",
  "v0.8.0 — Projects directory",
  "v0.7.3 — Model catalog refresh",
  "v0.7.2 — BYOK key rotation",
  "v0.7.1 — MCP transport fallback",
  "v0.7.0 — Web search citations",
  "v0.6.4 — Composer polish",
  "v0.6.3 — Scroll architecture",
]

const defaultCode = `import { ScrollArea } from "@/components/ui/scroll-area"

const releaseNotes = [
  "v0.9.0 — Durable turn runtime",
  "v0.8.2 — Streaming renderer fixes",
  "v0.8.1 — Sidebar row system",
  "v0.8.0 — Projects directory",
  "v0.7.3 — Model catalog refresh",
  "v0.7.2 — BYOK key rotation",
  "v0.7.1 — MCP transport fallback",
  "v0.7.0 — Web search citations",
  "v0.6.4 — Composer polish",
  "v0.6.3 — Scroll architecture",
]

export function ScrollAreaDefault() {
  return (
    <ScrollArea className="h-56 w-64 rounded-md border">
      <div className="p-4">
        <h4 className="mb-3 text-sm font-medium">Release notes</h4>
        {releaseNotes.map((note) => (
          <div key={note} className="border-b py-2 text-sm last:border-b-0">
            {note}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}`

const apiRows = [
  {
    prop: "className",
    type: "string",
    defaultValue: "—",
    description:
      "Applied to the root. Size the scroll area here — the viewport fills the root.",
  },
  {
    prop: "viewportRef",
    type: "Ref<HTMLDivElement>",
    defaultValue: "—",
    description:
      "Ref to the scrollable viewport element, for programmatic scrolling or measurement.",
  },
  {
    prop: "children",
    type: "ReactNode",
    defaultValue: "—",
    description: "Rendered inside the viewport.",
  },
  {
    prop: "ScrollBar orientation",
    type: '"vertical" | "horizontal"',
    defaultValue: '"vertical"',
    description:
      "Axis of an additional scrollbar. ScrollArea already renders a vertical one; add a horizontal ScrollBar for two-axis content.",
  },
] as const

export const metadata: Metadata = {
  title: "Scroll Area | Design System",
  description:
    "Base UI scroll area with a styled overlay scrollbar and a viewport ref escape hatch.",
}

export default function ScrollAreaPage() {
  const scrollAreaSource = readComponentSource("components/ui/scroll-area.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="scroll-area"
        title="Scroll Area"
        description="Custom-scrollbar scrolling region built on the Base UI ScrollArea primitive, with a keyboard-focusable viewport."
      />

      <DsSection
        id="default"
        title="Default"
        description="Constrain the root with a height or width and let content overflow the viewport. The styled scrollbar thumb replaces the native one."
      >
        <ComponentPreview code={defaultCode} sourceCode={scrollAreaSource}>
          <ScrollArea className="h-56 w-64 rounded-md border">
            <div className="p-4">
              <h4 className="mb-3 text-sm font-medium">Release notes</h4>
              {releaseNotes.map((note) => (
                <div
                  key={note}
                  className="border-b py-2 text-sm last:border-b-0"
                >
                  {note}
                </div>
              ))}
            </div>
          </ScrollArea>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[22, 26, 14, 38]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI ScrollArea root props are forwarded. ScrollBar is
          exported separately for composing a horizontal scrollbar alongside
          the built-in vertical one.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
