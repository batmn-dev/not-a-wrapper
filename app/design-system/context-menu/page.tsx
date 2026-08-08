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
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import type { Metadata } from "next"

const defaultCode = `import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

export function ContextMenuDefault() {
  return (
    <ContextMenu>
      <ContextMenuTrigger className="text-muted-foreground flex h-36 w-64 items-center justify-center rounded-xl border border-dashed text-sm">
        Right-click here
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem>
          Back
          <ContextMenuShortcut>⌘[</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          Reload
          <ContextMenuShortcut>⌘R</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>More tools</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem>Save page…</ContextMenuItem>
            <ContextMenuItem>Create shortcut…</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem defaultChecked>
          Show bookmarks
        </ContextMenuCheckboxItem>
        <ContextMenuSeparator />
        <ContextMenuLabel>People</ContextMenuLabel>
        <ContextMenuRadioGroup defaultValue="andres">
          <ContextMenuRadioItem value="andres">Andres</ContextMenuRadioItem>
          <ContextMenuRadioItem value="alex">Alex</ContextMenuRadioItem>
        </ContextMenuRadioGroup>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}`

const apiRows = [
  {
    prop: "ContextMenu onOpenChange",
    type: "(open, eventDetails) => void",
    defaultValue: "—",
    description:
      "Fires when the menu opens from a right-click or closes. The root also accepts open/defaultOpen.",
  },
  {
    prop: "ContextMenuTrigger",
    type: "Base UI Trigger props",
    defaultValue: "—",
    description:
      "Wraps the right-clickable surface; the menu opens at the pointer position.",
  },
  {
    prop: "ContextMenuContent align / side",
    type: '"start" | "center" | "end" / "top" | "bottom" | "left" | "right"',
    defaultValue: '"start" / "right"',
    description:
      "Placement relative to the pointer anchor, with alignOffset (4) and sideOffset (0) fine-tuning.",
  },
  {
    prop: "ContextMenuItem variant",
    type: '"default" | "destructive"',
    defaultValue: '"default"',
    description: "Destructive items render in the destructive color.",
  },
  {
    prop: "ContextMenuItem inset",
    type: "boolean",
    defaultValue: "—",
    description:
      "Pads the left edge to align with checkbox and radio indicators.",
  },
  {
    prop: "ContextMenuCheckboxItem checked",
    type: "boolean",
    defaultValue: "—",
    description:
      "Controlled checked state with onCheckedChange. Use defaultChecked when uncontrolled.",
  },
  {
    prop: "ContextMenuRadioGroup value",
    type: "any",
    defaultValue: "—",
    description:
      "Controlled selected value with onValueChange. Use defaultValue when uncontrolled.",
  },
] as const

export const metadata: Metadata = {
  title: "Context Menu | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Context Menu component.",
}

export default function ContextMenuPage() {
  const contextMenuSource = readComponentSource(
    "components/ui/context-menu.tsx"
  )

  return (
    <DsPage>
      <DsPageHeader
        slug="context-menu"
        title="Context Menu"
        description="Base UI menu opened by right-clicking a surface, with items, submenus, and checkbox or radio selection."
      />

      <DsSection
        id="default"
        title="Default"
        description="Right-click the dashed area. The menu opens at the pointer and supports the full menu vocabulary: shortcuts, a submenu, checkbox and radio items, and a destructive item."
      >
        <ComponentPreview code={defaultCode} sourceCode={contextMenuSource}>
          <ContextMenu>
            <ContextMenuTrigger className="text-muted-foreground flex h-36 w-64 items-center justify-center rounded-xl border border-dashed text-sm">
              Right-click here
            </ContextMenuTrigger>
            <ContextMenuContent className="w-52">
              <ContextMenuItem>
                Back
                <ContextMenuShortcut>⌘[</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem>
                Reload
                <ContextMenuShortcut>⌘R</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger>More tools</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem>Save page…</ContextMenuItem>
                  <ContextMenuItem>Create shortcut…</ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
              <ContextMenuCheckboxItem defaultChecked>
                Show bookmarks
              </ContextMenuCheckboxItem>
              <ContextMenuSeparator />
              <ContextMenuLabel>People</ContextMenuLabel>
              <ContextMenuRadioGroup defaultValue="andres">
                <ContextMenuRadioItem value="andres">
                  Andres
                </ContextMenuRadioItem>
                <ContextMenuRadioItem value="alex">Alex</ContextMenuRadioItem>
              </ContextMenuRadioGroup>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 26, 12, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Context Menu props are forwarded from each wrapper.
          Unlike the dropdown menu, content width does not track an anchor —
          the popup sizes to its content with a min-width.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
