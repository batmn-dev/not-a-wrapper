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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  RiArrowRightSLine,
  RiFileTextLine,
  RiFolderLine,
} from "@remixicon/react"
import type { Metadata } from "next"

const defaultCode = `import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { RiArrowRightSLine, RiFolderLine } from "@remixicon/react"

export function ItemDefault() {
  return (
    <ItemGroup className="max-w-sm">
      <Item variant="outline">
        <ItemMedia variant="icon">
          <RiFolderLine />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Design system</ItemTitle>
          <ItemDescription>12 chats · updated today</ItemDescription>
        </ItemContent>
        <ItemActions>
          <RiArrowRightSLine className="text-muted-foreground size-4" />
        </ItemActions>
      </Item>
      <Item variant="outline">
        <ItemMedia variant="icon">
          <RiFolderLine />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Streaming research</ItemTitle>
          <ItemDescription>4 chats · updated yesterday</ItemDescription>
        </ItemContent>
        <ItemActions>
          <RiArrowRightSLine className="text-muted-foreground size-4" />
        </ItemActions>
      </Item>
    </ItemGroup>
  )
}`

const compactCode = `import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { RiFileTextLine } from "@remixicon/react"

export function ItemCompact() {
  return (
    <ItemGroup className="max-w-sm">
      <Item variant="muted" size="sm">
        <ItemMedia variant="icon">
          <RiFileTextLine />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>notes.md</ItemTitle>
          <ItemDescription>2.4 KB</ItemDescription>
        </ItemContent>
      </Item>
      <Item variant="muted" size="sm">
        <ItemMedia variant="icon">
          <RiFileTextLine />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>transcript.md</ItemTitle>
          <ItemDescription>18 KB</ItemDescription>
        </ItemContent>
      </Item>
    </ItemGroup>
  )
}`

const apiRows = [
  {
    prop: "variant",
    type: '"default" | "outline" | "muted"',
    defaultValue: '"default"',
    description:
      "Surface treatment of the row: bare, bordered, or muted background.",
  },
  {
    prop: "size",
    type: '"default" | "sm" | "xs"',
    defaultValue: '"default"',
    description:
      "Padding and gap scale. ItemGroup tightens its own gap to match nested sm/xs items.",
  },
  {
    prop: "render",
    type: "ReactElement | render function",
    defaultValue: "—",
    description:
      "Replaces the div with another element, e.g. a link — anchor items pick up a hover tint.",
  },
  {
    prop: "ItemMedia variant",
    type: '"default" | "icon" | "image"',
    defaultValue: '"default"',
    description:
      "Leading media slot: transparent, icon-sized, or a rounded image thumbnail that scales with item size.",
  },
  {
    prop: "ItemContent / ItemTitle / ItemDescription",
    type: 'ComponentProps<"div" | "p">',
    defaultValue: "—",
    description:
      "Flexible text column with a clamped title and two-line clamped description.",
  },
  {
    prop: "ItemActions",
    type: 'ComponentProps<"div">',
    defaultValue: "—",
    description: "Trailing slot for buttons, badges, or indicator icons.",
  },
  {
    prop: "ItemHeader / ItemFooter / ItemSeparator",
    type: "ComponentProps",
    defaultValue: "—",
    description:
      "Full-width rows above/below the media line, and a horizontal divider for use inside ItemGroup.",
  },
] as const

export const metadata: Metadata = {
  title: "Item | Design System",
  description:
    "Composable list-row primitive with media, content, and action slots in three sizes.",
}

export default function ItemPage() {
  const itemSource = readComponentSource("components/ui/item.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="item"
        title="Item"
        description="The generic list row: a flexible flex container with leading media, a text column, and trailing actions, sized for lists, pickers, and attachments."
      />

      <DsSection
        id="default"
        title="Default"
        description="Outline items in an ItemGroup. The group renders role=list and manages vertical rhythm between rows."
      >
        <ComponentPreview code={defaultCode} sourceCode={itemSource}>
          <ItemGroup className="max-w-sm">
            <Item variant="outline">
              <ItemMedia variant="icon">
                <RiFolderLine />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Design system</ItemTitle>
                <ItemDescription>12 chats · updated today</ItemDescription>
              </ItemContent>
              <ItemActions>
                <RiArrowRightSLine className="text-muted-foreground size-4" />
              </ItemActions>
            </Item>
            <Item variant="outline">
              <ItemMedia variant="icon">
                <RiFolderLine />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Streaming research</ItemTitle>
                <ItemDescription>4 chats · updated yesterday</ItemDescription>
              </ItemContent>
              <ItemActions>
                <RiArrowRightSLine className="text-muted-foreground size-4" />
              </ItemActions>
            </Item>
          </ItemGroup>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="compact"
        title="Muted, small"
        description="The muted variant at size sm suits dense secondary lists like attachments. The group's gap tightens automatically for sm and xs items."
      >
        <ComponentPreview code={compactCode} sourceCode={itemSource}>
          <ItemGroup className="max-w-sm">
            <Item variant="muted" size="sm">
              <ItemMedia variant="icon">
                <RiFileTextLine />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>notes.md</ItemTitle>
                <ItemDescription>2.4 KB</ItemDescription>
              </ItemContent>
            </Item>
            <Item variant="muted" size="sm">
              <ItemMedia variant="icon">
                <RiFileTextLine />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>transcript.md</ItemTitle>
                <ItemDescription>18 KB</ItemDescription>
              </ItemContent>
            </Item>
          </ItemGroup>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 26, 12, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Item uses Base UI useRender, so its render prop composes links and
          buttons while keeping the row styling. All other parts are plain
          element wrappers that forward native attributes.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
