import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Skeleton } from "@/components/ui/skeleton"
import type { Metadata } from "next"

const usageCode = `import { Skeleton } from "@/components/ui/skeleton"

export function SkeletonDemo() {
  return (
    <div className="flex w-64 items-center gap-4">
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="w-full space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  )
}`

const apiRows = [
  {
    prop: "className",
    type: "string",
    defaultValue: "—",
    description:
      "Gives the placeholder its shape: set width, height, and radius to mirror the content it stands in for.",
  },
] as const

export const metadata: Metadata = {
  title: "Skeleton | Design System",
  description:
    "Documentation and usage for the Not A Wrapper Skeleton component.",
}

export default function SkeletonPage() {
  const skeletonSource = readComponentSource("components/ui/skeleton.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="skeleton"
        title="Skeleton"
        description="Pulsing muted placeholder that holds the layout while content loads."
      />

      <DsSection
        id="usage"
        title="Usage"
        description="Compose shapes that match the loaded state so nothing shifts when real content arrives."
      >
        <ComponentPreview code={usageCode} sourceCode={skeletonSource}>
          <div className="flex w-64 items-center gap-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="w-full space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[16, 20, 14, 50]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Skeleton renders a div and forwards all standard div attributes; the
          base styles are just bg-muted, animate-pulse, and rounded-md.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
