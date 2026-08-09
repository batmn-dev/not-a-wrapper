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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Metadata } from "next"

const defaultCode = `import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function TableDefault() {
  return (
    <div className="w-full max-w-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead className="text-right">Context</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">Sonnet</TableCell>
            <TableCell>Anthropic</TableCell>
            <TableCell className="text-right">200k</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">GPT-5 Mini</TableCell>
            <TableCell>OpenAI</TableCell>
            <TableCell className="text-right">400k</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Gemini Flash</TableCell>
            <TableCell>Google</TableCell>
            <TableCell className="text-right">1M</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}`

const apiRows = [
  {
    prop: "Table",
    type: 'ComponentProps<"table">',
    defaultValue: "—",
    description:
      "The table element, wrapped in a full-width overflow-x-auto container so wide tables scroll instead of breaking layout.",
  },
  {
    prop: "TableHeader / TableBody / TableFooter",
    type: 'ComponentProps<"thead" | "tbody" | "tfoot">',
    defaultValue: "—",
    description:
      "Section wrappers. Header rows draw a bottom border; the last body row drops its border; the footer carries a muted background.",
  },
  {
    prop: "TableRow",
    type: 'ComponentProps<"tr">',
    defaultValue: "—",
    description:
      "Row with hover tint. Set data-state=\"selected\" to apply the selected background.",
  },
  {
    prop: "TableHead / TableCell",
    type: 'ComponentProps<"th" | "td">',
    defaultValue: "—",
    description:
      "Cells with the shared padding and alignment defaults, including checkbox alignment fixes.",
  },
  {
    prop: "TableCaption",
    type: 'ComponentProps<"caption">',
    defaultValue: "—",
    description: "Muted caption rendered below the table.",
  },
] as const

export const metadata: Metadata = {
  title: "Table | Design System",
  description:
    "Styled native table primitives used for tabular data across the app, including this registry's API tables.",
}

export default function TablePage() {
  const tableSource = readComponentSource("components/ui/table.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="table"
        title="Table"
        description="Thin styled wrappers around native table elements, with an overflow container, row hover, and a selected-row state hook."
      />

      <DsSection
        id="default"
        title="Default"
        description="Compose the wrappers exactly like native table markup. The root renders inside an overflow-x-auto container, so wide tables scroll horizontally on their own."
      >
        <ComponentPreview code={defaultCode} sourceCode={tableSource}>
          <div className="w-full max-w-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Context</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Sonnet</TableCell>
                  <TableCell>Anthropic</TableCell>
                  <TableCell className="text-right">200k</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">GPT-5 Mini</TableCell>
                  <TableCell>OpenAI</TableCell>
                  <TableCell className="text-right">400k</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Gemini Flash</TableCell>
                  <TableCell>Google</TableCell>
                  <TableCell className="text-right">1M</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[22, 28, 10, 40]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Every part forwards all native attributes of its underlying element
          and accepts className overrides. There are no Base UI primitives
          involved — these are plain semantic table elements.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
