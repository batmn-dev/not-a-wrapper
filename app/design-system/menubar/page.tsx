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
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar"
import type { Metadata } from "next"

const defaultCode = `import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar"

export function MenubarDefault() {
  return (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>
            New chat
            <MenubarShortcut>⌘N</MenubarShortcut>
          </MenubarItem>
          <MenubarItem>
            New window
            <MenubarShortcut>⇧⌘N</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>Share</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarItem>Copy link</MenubarItem>
              <MenubarItem>Email</MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem>
            Print
            <MenubarShortcut>⌘P</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>
            Undo
            <MenubarShortcut>⌘Z</MenubarShortcut>
          </MenubarItem>
          <MenubarItem>
            Redo
            <MenubarShortcut>⇧⌘Z</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarContent>
          <MenubarCheckboxItem defaultChecked>
            Show sidebar
          </MenubarCheckboxItem>
          <MenubarCheckboxItem>Show status bar</MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarRadioGroup defaultValue="comfortable">
            <MenubarRadioItem value="comfortable">Comfortable</MenubarRadioItem>
            <MenubarRadioItem value="compact">Compact</MenubarRadioItem>
          </MenubarRadioGroup>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  )
}`

const apiRows = [
  {
    prop: "Menubar modal",
    type: "boolean",
    defaultValue: "true",
    description: "Whether open menus trap interaction outside the menubar.",
  },
  {
    prop: "Menubar orientation",
    type: '"horizontal" | "vertical"',
    defaultValue: '"horizontal"',
    description: "Layout axis and arrow-key direction across triggers.",
  },
  {
    prop: "Menubar loopFocus",
    type: "boolean",
    defaultValue: "true",
    description:
      "Loops keyboard focus back to the first item at the end of the list.",
  },
  {
    prop: "MenubarMenu",
    type: "DropdownMenu root props",
    defaultValue: "—",
    description:
      "One per top-level menu; accepts open/onOpenChange/defaultOpen like the dropdown root.",
  },
  {
    prop: "MenubarTrigger render",
    type: "ReactElement | render function",
    defaultValue: "<button>",
    description:
      "Element rendered as the menu's trigger in the bar (Base UI render prop).",
  },
  {
    prop: "MenubarContent align / alignOffset / sideOffset",
    type: '"start" | "center" | "end" / number / number',
    defaultValue: '"start" / -4 / 8',
    description: "Popup placement relative to the trigger.",
  },
  {
    prop: "MenubarItem variant / inset",
    type: '"default" | "destructive" / boolean',
    defaultValue: '"default" / —',
    description:
      "Destructive coloring, and left padding that aligns with indicator items.",
  },
  {
    prop: "MenubarCheckboxItem checked",
    type: "boolean",
    defaultValue: "—",
    description:
      "Controlled checked state with onCheckedChange. Use defaultChecked when uncontrolled.",
  },
  {
    prop: "MenubarRadioGroup value",
    type: "any",
    defaultValue: "—",
    description:
      "Controlled selected value with onValueChange. Use defaultValue when uncontrolled.",
  },
] as const

export const metadata: Metadata = {
  title: "Menubar | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Menubar component.",
}

export default function MenubarPage() {
  const menubarSource = readComponentSource("components/ui/menubar.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="menubar"
        title="Menubar"
        description="Desktop-style menu bar built on the dropdown menu wrappers: sibling menus with roving focus and hover hand-off between open triggers."
      />

      <DsSection
        id="default"
        title="Default"
        description="A bar of sibling menus. Once one menu is open, hovering an adjacent trigger opens it — the classic application menubar interaction."
      >
        <ComponentPreview code={defaultCode} sourceCode={menubarSource}>
          <Menubar>
            <MenubarMenu>
              <MenubarTrigger>File</MenubarTrigger>
              <MenubarContent>
                <MenubarItem>
                  New chat
                  <MenubarShortcut>⌘N</MenubarShortcut>
                </MenubarItem>
                <MenubarItem>
                  New window
                  <MenubarShortcut>⇧⌘N</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarSub>
                  <MenubarSubTrigger>Share</MenubarSubTrigger>
                  <MenubarSubContent>
                    <MenubarItem>Copy link</MenubarItem>
                    <MenubarItem>Email</MenubarItem>
                  </MenubarSubContent>
                </MenubarSub>
                <MenubarSeparator />
                <MenubarItem>
                  Print
                  <MenubarShortcut>⌘P</MenubarShortcut>
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger>Edit</MenubarTrigger>
              <MenubarContent>
                <MenubarItem>
                  Undo
                  <MenubarShortcut>⌘Z</MenubarShortcut>
                </MenubarItem>
                <MenubarItem>
                  Redo
                  <MenubarShortcut>⇧⌘Z</MenubarShortcut>
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger>View</MenubarTrigger>
              <MenubarContent>
                <MenubarCheckboxItem defaultChecked>
                  Show sidebar
                </MenubarCheckboxItem>
                <MenubarCheckboxItem>Show status bar</MenubarCheckboxItem>
                <MenubarSeparator />
                <MenubarRadioGroup defaultValue="comfortable">
                  <MenubarRadioItem value="comfortable">
                    Comfortable
                  </MenubarRadioItem>
                  <MenubarRadioItem value="compact">Compact</MenubarRadioItem>
                </MenubarRadioGroup>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[28, 26, 12, 34]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Every Menubar part except the bar itself delegates to the dropdown
          menu wrappers, so the full dropdown vocabulary (labels, groups,
          portals, submenus) applies here unchanged.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
