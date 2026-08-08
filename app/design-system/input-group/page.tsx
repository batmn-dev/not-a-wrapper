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
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { RiSearchLine } from "@remixicon/react"
import type { Metadata } from "next"

const addonsCode = `import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { RiSearchLine } from "@remixicon/react"

export function InputGroupAddons() {
  return (
    <div className="flex w-72 flex-col gap-4">
      <InputGroup>
        <InputGroupAddon>
          <RiSearchLine />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search chats" />
        <InputGroupAddon align="inline-end">
          <Kbd>⌘K</Kbd>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>https://</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="example.com" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton>Copy</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}`

const textareaCode = `import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group"

export function InputGroupWithTextarea() {
  return (
    <InputGroup className="w-72">
      <InputGroupTextarea placeholder="Ask anything" rows={3} />
      <InputGroupAddon align="block-end">
        <InputGroupText>3 credits left</InputGroupText>
        <InputGroupButton variant="default" size="sm" className="ml-auto">
          Send
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}`

const apiRows = [
  {
    prop: "InputGroupAddon align",
    type: '"inline-start" | "inline-end" | "block-start" | "block-end"',
    defaultValue: '"inline-start"',
    description:
      "Where the addon sits: beside the control, or as a full-width row above/below it (block aligns switch the group to a column).",
  },
  {
    prop: "InputGroupButton size",
    type: '"xs" | "sm" | "icon-xs" | "icon-sm"',
    defaultValue: '"xs"',
    description: "Compact button sizes tuned to fit inside the group chrome.",
  },
  {
    prop: "InputGroupButton variant",
    type: "Button variant",
    defaultValue: '"ghost"',
    description: "Forwards to Button; any button variant works.",
  },
  {
    prop: "InputGroupInput",
    type: "input props",
    defaultValue: "—",
    description:
      "Borderless Input wired as the group control; the group draws the border, focus ring, and invalid styling.",
  },
  {
    prop: "InputGroupTextarea",
    type: "textarea props",
    defaultValue: "—",
    description:
      "Textarea variant of the control; the group grows to auto height.",
  },
  {
    prop: "InputGroupText",
    type: "span props",
    defaultValue: "—",
    description: "Muted inline text or icon content inside an addon.",
  },
] as const

export const metadata: Metadata = {
  title: "Input Group | Design System",
  description:
    "Single-control input surface with inline and block addons: icons, text, keyboard hints, and buttons.",
}

export default function InputGroupPage() {
  const inputGroupSource = readComponentSource("components/ui/input-group.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="input-group"
        title="Input Group"
        description="One bordered surface around an input or textarea plus addons — icons, prefixes, keyboard hints, and buttons — with focus and invalid styling owned by the group."
      />

      <DsSection
        id="addons"
        title="Inline addons"
        description="Addons sit beside the control; clicking one focuses the input. Use InputGroupText for static content and InputGroupButton for actions."
      >
        <ComponentPreview code={addonsCode} sourceCode={inputGroupSource}>
          <div className="flex w-72 flex-col gap-4">
            <InputGroup>
              <InputGroupAddon>
                <RiSearchLine />
              </InputGroupAddon>
              <InputGroupInput placeholder="Search chats" />
              <InputGroupAddon align="inline-end">
                <Kbd>⌘K</Kbd>
              </InputGroupAddon>
            </InputGroup>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>https://</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput placeholder="example.com" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton>Copy</InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="textarea"
        title="Textarea with block addon"
        description="block-end addons render as a full-width row under the control — the composer shape: helper text on the left, primary action on the right."
      >
        <ComponentPreview code={textareaCode} sourceCode={inputGroupSource}>
          <InputGroup className="w-72">
            <InputGroupTextarea placeholder="Ask anything" rows={3} />
            <InputGroupAddon align="block-end">
              <InputGroupText>3 credits left</InputGroupText>
              <InputGroupButton
                variant="default"
                size="sm"
                className="ml-auto"
              >
                Send
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[24, 30, 12, 34]} rows={apiRows} />
        <DsParagraph className="mt-3">
          InputGroup itself is a styled div; it derives its focus ring, invalid
          ring, and column layout from the slots and alignment of its children.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
