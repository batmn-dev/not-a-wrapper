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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Metadata } from "next"

const models = {
  "claude-sonnet-4-5": "Claude Sonnet 4.5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "gpt-5": "GPT-5",
  "gpt-5-mini": "GPT-5 Mini",
}

const defaultCode = `import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const models = {
  "claude-sonnet-4-5": "Claude Sonnet 4.5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "gpt-5": "GPT-5",
  "gpt-5-mini": "GPT-5 Mini",
}

export function SelectDefault() {
  return (
    <Select defaultValue="claude-sonnet-4-5" items={models}>
      <SelectTrigger className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(models).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}`

const groupsCode = `import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const models = {
  "claude-sonnet-4-5": "Claude Sonnet 4.5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "gpt-5": "GPT-5",
  "gpt-5-mini": "GPT-5 Mini",
}

export function SelectGroups() {
  return (
    <Select defaultValue="claude-sonnet-4-5" items={models}>
      <SelectTrigger size="sm" className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Anthropic</SelectLabel>
          <SelectItem value="claude-sonnet-4-5">Claude Sonnet 4.5</SelectItem>
          <SelectItem value="claude-haiku-4-5">Claude Haiku 4.5</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>OpenAI</SelectLabel>
          <SelectItem value="gpt-5">GPT-5</SelectItem>
          <SelectItem value="gpt-5-mini">GPT-5 Mini</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}`

const apiRows = [
  {
    prop: "value / onValueChange",
    type: "string / (value) => void",
    defaultValue: "—",
    description:
      "Controlled selection and its change handler, on the Select root. Use defaultValue when uncontrolled.",
  },
  {
    prop: "items",
    type: "Record<string, ReactNode>",
    defaultValue: "—",
    description:
      "Value-to-label map so SelectValue renders the label instead of the raw value.",
  },
  {
    prop: "SelectTrigger size",
    type: '"default" | "sm"',
    defaultValue: '"default"',
    description: "Trigger height: 40px default or 36px small.",
  },
  {
    prop: "SelectContent side / align",
    type: "Positioner props",
    defaultValue: '"bottom" / "center"',
    description:
      "Popup placement; sideOffset and alignOffset fine-tune the distance.",
  },
  {
    prop: "SelectContent alignItemWithTrigger",
    type: "boolean",
    defaultValue: "true",
    description:
      "Overlaps the popup so the selected item sits on the trigger, macOS style.",
  },
  {
    prop: "SelectItem value / disabled",
    type: "string / boolean",
    defaultValue: "—",
    description:
      "Identifies the option; disabled items stay visible but unselectable.",
  },
] as const

export const metadata: Metadata = {
  title: "Select | Design System",
  description:
    "Base UI select with design-system trigger and popup styling, groups, and scroll arrows.",
}

export default function SelectPage() {
  const selectSource = readComponentSource("components/ui/select.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="select"
        title="Select"
        description="Base UI select behind the app's dropdowns: styled trigger and popup, check-marked items, groups, and the selected item aligned over the trigger."
      />

      <DsSection
        id="default"
        title="Default"
        description="Pass an items map on the root so SelectValue shows the label for the selected value. The popup opens aligned so the selected item covers the trigger."
      >
        <ComponentPreview code={defaultCode} sourceCode={selectSource}>
          <Select defaultValue="claude-sonnet-4-5" items={models}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(models).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="groups"
        title="Groups and sizes"
        description="SelectGroup with SelectLabel organizes long lists, SelectSeparator draws the rule between them, and the sm trigger matches small controls."
      >
        <ComponentPreview code={groupsCode} sourceCode={selectSource}>
          <Select defaultValue="claude-sonnet-4-5" items={models}>
            <SelectTrigger size="sm" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Anthropic</SelectLabel>
                <SelectItem value="claude-sonnet-4-5">
                  Claude Sonnet 4.5
                </SelectItem>
                <SelectItem value="claude-haiku-4-5">
                  Claude Haiku 4.5
                </SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>OpenAI</SelectLabel>
                <SelectItem value="gpt-5">GPT-5</SelectItem>
                <SelectItem value="gpt-5-mini">GPT-5 Mini</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[28, 24, 14, 34]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Select is the unwrapped Base UI root, so every root prop (multiple,
          disabled, name, required, onOpenChange) is available directly.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
