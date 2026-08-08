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
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import type { Metadata } from "next"

const defaultCode = `import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

export function PaginationDefault() {
  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">1</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" isActive>
            2
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">3</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}`

const apiRows = [
  {
    prop: "PaginationLink isActive",
    type: "boolean",
    defaultValue: "—",
    description:
      "Marks the current page: outline button styling plus aria-current=\"page\".",
  },
  {
    prop: "PaginationLink size",
    type: "Button size",
    defaultValue: '"icon"',
    description:
      "Button size token for the link; Previous/Next use \"default\" for their labels.",
  },
  {
    prop: "PaginationLink href",
    type: "string",
    defaultValue: "—",
    description:
      "Standard anchor props; renders a plain <a> styled via buttonVariants.",
  },
  {
    prop: "PaginationPrevious / PaginationNext",
    type: "PaginationLink props",
    defaultValue: "—",
    description:
      "Labeled prev/next links with chevrons; the text label hides below the sm breakpoint.",
  },
  {
    prop: "PaginationEllipsis",
    type: "span props",
    defaultValue: "—",
    description:
      "Decorative gap marker with a screen-reader-only \"More pages\" label.",
  },
] as const

export const metadata: Metadata = {
  title: "Pagination | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Pagination component.",
}

export default function PaginationPage() {
  const paginationSource = readComponentSource("components/ui/pagination.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="pagination"
        title="Pagination"
        description="Page navigation with previous/next links, numbered pages styled as buttons, and an ellipsis for collapsed ranges."
      />

      <DsSection
        id="default"
        title="Default"
        description="A nav landmark wrapping a list of page links. The active page renders as an outline button; every other link is a ghost button."
      >
        <ComponentPreview code={defaultCode} sourceCode={paginationSource}>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#" />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">1</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" isActive>
                  2
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">3</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
              <PaginationItem>
                <PaginationNext href="#" />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[28, 22, 12, 38]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Pagination, PaginationContent, and PaginationItem are plain nav/ul/li
          elements that accept their standard attributes. For client-side
          routing, swap the anchor for a Next.js Link with the same classes.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
