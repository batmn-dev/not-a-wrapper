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
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import type { Metadata } from "next"

const defaultCode = `import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export function BreadcrumbDefault() {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbEllipsis />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Projects</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Design System</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}`

const apiRows = [
  {
    prop: "BreadcrumbLink render",
    type: "ReactElement | render function",
    defaultValue: "<a>",
    description:
      "Replaces the anchor via Base UI useRender — compose a Next.js Link here for client-side routing.",
  },
  {
    prop: "BreadcrumbLink href",
    type: "string",
    defaultValue: "—",
    description: "Standard anchor attributes for the default <a> element.",
  },
  {
    prop: "BreadcrumbPage",
    type: "span props",
    defaultValue: "—",
    description:
      "The current page: a non-interactive span with aria-current=\"page\".",
  },
  {
    prop: "BreadcrumbSeparator children",
    type: "ReactNode",
    defaultValue: "chevron icon",
    description:
      "Custom separator glyph; the aria-hidden li defaults to a right chevron.",
  },
  {
    prop: "BreadcrumbEllipsis",
    type: "span props",
    defaultValue: "—",
    description:
      "Collapsed-segments marker with a screen-reader-only \"More\" label.",
  },
] as const

export const metadata: Metadata = {
  title: "Breadcrumb | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Breadcrumb component.",
}

export default function BreadcrumbDocsPage() {
  const breadcrumbSource = readComponentSource("components/ui/breadcrumb.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="breadcrumb"
        title="Breadcrumb"
        description="Hierarchy trail for the current page: links for ancestors, a plain span for the current page, and an ellipsis for collapsed segments."
      />

      <DsSection
        id="default"
        title="Default"
        description="A nav landmark wrapping an ordered list. Ancestor segments are links, the last segment is the current page, and long trails collapse behind an ellipsis."
      >
        <ComponentPreview code={defaultCode} sourceCode={breadcrumbSource}>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbEllipsis />
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Projects</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Design System</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 24, 14, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Breadcrumb, BreadcrumbList, and BreadcrumbItem are plain nav/ol/li
          elements that accept their standard attributes. BreadcrumbLink is the
          only part with a render prop.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
