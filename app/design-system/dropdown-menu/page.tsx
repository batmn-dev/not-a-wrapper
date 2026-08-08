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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  RiDeleteBinLine,
  RiSettings3Line,
  RiUserLine,
} from "@remixicon/react"
import type { Metadata } from "next"

const defaultCode = `import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RiDeleteBinLine, RiSettings3Line, RiUserLine } from "@remixicon/react"

export function DropdownMenuDefault() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline">Open menu</Button>} />
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <RiUserLine />
            Profile
            <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <RiSettings3Line />
            Settings
            <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Invite users</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Email</DropdownMenuItem>
            <DropdownMenuItem>Message</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <RiDeleteBinLine />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}`

const selectionCode = `import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function DropdownMenuSelection() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline">View options</Button>} />
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuCheckboxItem defaultChecked>
          Status bar
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem>Activity panel</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Density</DropdownMenuLabel>
        <DropdownMenuRadioGroup defaultValue="comfortable">
          <DropdownMenuRadioItem value="comfortable">
            Comfortable
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}`

const apiRows = [
  {
    prop: "DropdownMenu open / onOpenChange",
    type: "boolean / (open, eventDetails) => void",
    defaultValue: "—",
    description:
      "Controlled open state on the root. Use defaultOpen when uncontrolled.",
  },
  {
    prop: "DropdownMenuTrigger render",
    type: "ReactElement | render function",
    defaultValue: "<button>",
    description:
      "Element rendered as the trigger (Base UI render prop, not asChild).",
  },
  {
    prop: "DropdownMenuContent align / side",
    type: '"start" | "center" | "end" / "top" | "bottom" | "left" | "right"',
    defaultValue: '"start" / "bottom"',
    description:
      "Placement relative to the trigger, with alignOffset (0) and sideOffset (4) fine-tuning.",
  },
  {
    prop: "DropdownMenuContent animated",
    type: "boolean",
    defaultValue: "false",
    description: "Opt-in 100ms opacity fade on open and close.",
  },
  {
    prop: "DropdownMenuItem variant",
    type: '"default" | "destructive"',
    defaultValue: '"default"',
    description: "Destructive items render in the destructive color.",
  },
  {
    prop: "DropdownMenuItem inset",
    type: "boolean",
    defaultValue: "—",
    description:
      "Pads the left edge to align with checkbox and radio indicators.",
  },
  {
    prop: "DropdownMenuCheckboxItem checked",
    type: "boolean",
    defaultValue: "—",
    description:
      "Controlled checked state with onCheckedChange. Use defaultChecked when uncontrolled.",
  },
  {
    prop: "DropdownMenuRadioGroup value",
    type: "any",
    defaultValue: "—",
    description:
      "Controlled selected value with onValueChange. Use defaultValue when uncontrolled.",
  },
] as const

export const metadata: Metadata = {
  title: "Dropdown Menu | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Dropdown Menu component.",
}

export default function DropdownMenuPage() {
  const dropdownMenuSource = readComponentSource(
    "components/ui/dropdown-menu.tsx"
  )

  return (
    <DsPage>
      <DsPageHeader
        slug="dropdown-menu"
        title="Dropdown Menu"
        description="Base UI menu opened from a trigger, with items, groups, submenus, and checkbox or radio selection."
      />

      <DsSection
        id="default"
        title="Default"
        description="A trigger button opening a menu of actions: grouped items with icons and shortcuts, a submenu, and a destructive item."
      >
        <ComponentPreview code={defaultCode} sourceCode={dropdownMenuSource}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline">Open menu</Button>}
            />
            <DropdownMenuContent className="w-56">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem>
                  <RiUserLine />
                  Profile
                  <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <RiSettings3Line />
                  Settings
                  <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Invite users</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>Email</DropdownMenuItem>
                  <DropdownMenuItem>Message</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                <RiDeleteBinLine />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="selection"
        title="Checkbox and radio items"
        description="Menus can carry persistent selection: checkbox items toggle independently, radio items pick one value per group."
      >
        <ComponentPreview code={selectionCode} sourceCode={dropdownMenuSource}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline">View options</Button>}
            />
            <DropdownMenuContent className="w-56">
              <DropdownMenuLabel>Appearance</DropdownMenuLabel>
              <DropdownMenuCheckboxItem defaultChecked>
                Status bar
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem>Activity panel</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Density</DropdownMenuLabel>
              <DropdownMenuRadioGroup defaultValue="comfortable">
                <DropdownMenuRadioItem value="comfortable">
                  Comfortable
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="compact">
                  Compact
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 26, 12, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Content width tracks the trigger via --anchor-width by default; pass a
          width class to override. Remaining Base UI Menu props are forwarded
          from each wrapper.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
