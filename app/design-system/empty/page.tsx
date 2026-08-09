import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { RiInboxLine } from "@remixicon/react"
import type { Metadata } from "next"

const defaultCode = `import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { RiInboxLine } from "@remixicon/react"

export function EmptyDefault() {
  return (
    <Empty className="w-full max-w-sm p-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RiInboxLine />
        </EmptyMedia>
        <EmptyTitle>No projects yet</EmptyTitle>
        <EmptyDescription>
          Projects group related chats and files. Create one to get
          started.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" size="sm">
          New project
        </Button>
      </EmptyContent>
    </Empty>
  )
}`

const apiRows = [
  {
    prop: "Empty",
    type: 'ComponentProps<"div">',
    defaultValue: "—",
    description:
      "Dashed-border container that centers its children. Override the default p-12 via className in tight layouts.",
  },
  {
    prop: "EmptyHeader",
    type: 'ComponentProps<"div">',
    defaultValue: "—",
    description: "Stacks the media, title, and description with shared gaps.",
  },
  {
    prop: "EmptyMedia variant",
    type: '"default" | "icon"',
    defaultValue: '"default"',
    description:
      "default renders media transparently; icon wraps it in a muted rounded tile sized for a single icon.",
  },
  {
    prop: "EmptyTitle / EmptyDescription",
    type: 'ComponentProps<"div" | "p">',
    defaultValue: "—",
    description:
      "Heading-font title and muted description with styled inline links.",
  },
  {
    prop: "EmptyContent",
    type: 'ComponentProps<"div">',
    defaultValue: "—",
    description:
      "Slot below the header for actions like buttons or a docs link.",
  },
] as const

export const metadata: Metadata = {
  title: "Empty | Design System",
  description:
    "Composable empty-state block with media, title, description, and action slots.",
}

export default function EmptyPage() {
  const emptySource = readComponentSource("components/ui/empty.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="empty"
        title="Empty"
        description="The empty-state pattern for surfaces with nothing to show yet — a dashed container composing media, copy, and actions."
      />

      <DsSection
        id="default"
        title="Default"
        description="Compose only the parts you need. The icon media variant draws the muted tile; the plain variant suits illustrations or avatars."
      >
        <ComponentPreview code={defaultCode} sourceCode={emptySource}>
          <Empty className="w-full max-w-sm p-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RiInboxLine />
              </EmptyMedia>
              <EmptyTitle>No projects yet</EmptyTitle>
              <EmptyDescription>
                Projects group related chats and files. Create one to get
                started.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" size="sm">
                New project
              </Button>
            </EmptyContent>
          </Empty>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 24, 12, 38]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Every part is a plain element wrapper — all native div/p attributes
          and className overrides are forwarded.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
