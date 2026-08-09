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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import {
  RiChatNewLine,
  RiFolderLine,
  RiSearchLine,
} from "@remixicon/react"
import type { Metadata } from "next"

const defaultCode = `import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { RiChatNewLine, RiFolderLine, RiSearchLine } from "@remixicon/react"

export function CommandDefault() {
  return (
    <Command className="w-72">
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Suggestions">
          <CommandItem>
            <RiChatNewLine />
            New chat
          </CommandItem>
          <CommandItem>
            <RiFolderLine />
            New project
          </CommandItem>
          <CommandItem>
            <RiSearchLine />
            Search chats
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>
            Profile
            <CommandShortcut>⌘P</CommandShortcut>
          </CommandItem>
          <CommandItem>
            Billing
            <CommandShortcut>⌘B</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}`

const apiRows = [
  {
    prop: "Command value / onValueChange",
    type: "string / (value) => void",
    defaultValue: "—",
    description: "Controlled selected item value on the cmdk root.",
  },
  {
    prop: "Command shouldFilter",
    type: "boolean",
    defaultValue: "true",
    description:
      "Turn off cmdk's built-in filtering when you filter and sort items yourself.",
  },
  {
    prop: "Command filter",
    type: "(value, search, keywords) => number",
    defaultValue: "—",
    description:
      "Custom ranking function; return 0 to hide an item, higher to rank it above others.",
  },
  {
    prop: "Command loop",
    type: "boolean",
    defaultValue: "false",
    description:
      "Arrow keys wrap from the last item back to the first and vice versa.",
  },
  {
    prop: "CommandInput placeholder",
    type: "string",
    defaultValue: "—",
    description:
      "Search field rendered inside an InputGroup with a trailing search icon.",
  },
  {
    prop: "CommandItem value / keywords",
    type: "string / string[]",
    defaultValue: "text content / —",
    description:
      "What the filter matches against; keywords extend matching beyond the visible label.",
  },
  {
    prop: "CommandItem onSelect",
    type: "(value) => void",
    defaultValue: "—",
    description: "Fires when the item is clicked or chosen with Enter.",
  },
  {
    prop: "CommandItem disabled",
    type: "boolean",
    defaultValue: "false",
    description: "Prevents selecting the item.",
  },
  {
    prop: "CommandDialog open / onOpenChange",
    type: "boolean / (open, eventDetails) => void",
    defaultValue: "—",
    description:
      "Wraps a Command in the app Dialog for a ⌘K-style palette; also takes title, description, and showCloseButton.",
  },
] as const

export const metadata: Metadata = {
  title: "Command | Design System",
  description:
    "Documentation and usage examples for the Not A Wrapper Command palette component.",
}

export default function CommandPage() {
  const commandSource = readComponentSource("components/ui/command.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="command"
        title="Command"
        description="Filterable command palette built on cmdk, with grouped items, shortcuts, and an optional dialog wrapper for ⌘K flows."
      />

      <DsSection
        id="default"
        title="Default"
        description="Type in the input to filter items across groups; arrow keys move the selection and Enter chooses it."
      >
        <ComponentPreview code={defaultCode} sourceCode={commandSource}>
          <Command className="w-72">
            <CommandInput placeholder="Type a command or search…" />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup heading="Suggestions">
                <CommandItem>
                  <RiChatNewLine />
                  New chat
                </CommandItem>
                <CommandItem>
                  <RiFolderLine />
                  New project
                </CommandItem>
                <CommandItem>
                  <RiSearchLine />
                  Search chats
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Settings">
                <CommandItem>
                  Profile
                  <CommandShortcut>⌘P</CommandShortcut>
                </CommandItem>
                <CommandItem>
                  Billing
                  <CommandShortcut>⌘B</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 26, 14, 34]} rows={apiRows} />
        <DsParagraph className="mt-3">
          All wrappers forward the underlying cmdk props. CommandItem renders a
          trailing check icon that appears when the item carries
          data-checked, unless a CommandShortcut is present.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
