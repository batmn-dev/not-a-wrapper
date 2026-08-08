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
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select"
import type { Metadata } from "next"

const defaultCode = `import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select"

export function NativeSelectDefault() {
  return (
    <NativeSelect defaultValue="claude-sonnet-4-5" className="w-56">
      <NativeSelectOptGroup label="Anthropic">
        <NativeSelectOption value="claude-sonnet-4-5">
          Claude Sonnet 4.5
        </NativeSelectOption>
        <NativeSelectOption value="claude-haiku-4-5">
          Claude Haiku 4.5
        </NativeSelectOption>
      </NativeSelectOptGroup>
      <NativeSelectOptGroup label="OpenAI">
        <NativeSelectOption value="gpt-5">GPT-5</NativeSelectOption>
        <NativeSelectOption value="gpt-5-mini">GPT-5 Mini</NativeSelectOption>
      </NativeSelectOptGroup>
    </NativeSelect>
  )
}`

const sizesCode = `import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"

export function NativeSelectSizes() {
  return (
    <div className="flex flex-col items-center gap-4">
      <NativeSelect defaultValue="week" className="w-44">
        <NativeSelectOption value="day">Past day</NativeSelectOption>
        <NativeSelectOption value="week">Past week</NativeSelectOption>
        <NativeSelectOption value="month">Past month</NativeSelectOption>
      </NativeSelect>
      <NativeSelect size="sm" defaultValue="week" className="w-44">
        <NativeSelectOption value="day">Past day</NativeSelectOption>
        <NativeSelectOption value="week">Past week</NativeSelectOption>
        <NativeSelectOption value="month">Past month</NativeSelectOption>
      </NativeSelect>
    </div>
  )
}`

const apiRows = [
  {
    prop: "size",
    type: '"default" | "sm"',
    defaultValue: '"default"',
    description: "Control height: 40px default or 36px small.",
  },
  {
    prop: "defaultValue",
    type: "string",
    defaultValue: "—",
    description: "Initially selected option when uncontrolled.",
  },
  {
    prop: "value / onChange",
    type: "string / (event) => void",
    defaultValue: "—",
    description: "Controlled selection and native change handler.",
  },
  {
    prop: "disabled",
    type: "boolean",
    defaultValue: "false",
    description: "Disables the select and dims the wrapper.",
  },
  {
    prop: "aria-invalid",
    type: "boolean",
    defaultValue: "—",
    description: "Switches the border and ring to the destructive treatment.",
  },
  {
    prop: "NativeSelectOption / NativeSelectOptGroup",
    type: "option / optgroup props",
    defaultValue: "—",
    description:
      "Native option and optgroup elements with Canvas colors so the OS dropdown stays readable in both themes.",
  },
] as const

export const metadata: Metadata = {
  title: "Native Select | Design System",
  description:
    "Styled native select element with the design-system input chrome and the OS-rendered dropdown.",
}

export default function NativeSelectPage() {
  const nativeSelectSource = readComponentSource(
    "components/ui/native-select.tsx"
  )

  return (
    <DsPage>
      <DsPageHeader
        slug="native-select"
        title="Native Select"
        description="A real select element in design-system chrome: the trigger matches our inputs while the dropdown stays OS-native. Reach for it in plain forms; use Select when the popup needs custom rendering."
      />

      <DsSection
        id="default"
        title="Default"
        description="Options and optgroups are the native elements, so the open dropdown is rendered by the OS — free keyboard, mobile, and accessibility behavior."
      >
        <ComponentPreview code={defaultCode} sourceCode={nativeSelectSource}>
          <NativeSelect defaultValue="claude-sonnet-4-5" className="w-56">
            <NativeSelectOptGroup label="Anthropic">
              <NativeSelectOption value="claude-sonnet-4-5">
                Claude Sonnet 4.5
              </NativeSelectOption>
              <NativeSelectOption value="claude-haiku-4-5">
                Claude Haiku 4.5
              </NativeSelectOption>
            </NativeSelectOptGroup>
            <NativeSelectOptGroup label="OpenAI">
              <NativeSelectOption value="gpt-5">GPT-5</NativeSelectOption>
              <NativeSelectOption value="gpt-5-mini">
                GPT-5 Mini
              </NativeSelectOption>
            </NativeSelectOptGroup>
          </NativeSelect>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="sizes"
        title="Sizes"
        description="The sm size drops the control to 36px to sit alongside small buttons and inputs."
      >
        <ComponentPreview code={sizesCode} sourceCode={nativeSelectSource}>
          <div className="flex flex-col items-center gap-4">
            <NativeSelect defaultValue="week" className="w-44">
              <NativeSelectOption value="day">Past day</NativeSelectOption>
              <NativeSelectOption value="week">Past week</NativeSelectOption>
              <NativeSelectOption value="month">Past month</NativeSelectOption>
            </NativeSelect>
            <NativeSelect size="sm" defaultValue="week" className="w-44">
              <NativeSelectOption value="day">Past day</NativeSelectOption>
              <NativeSelectOption value="week">Past week</NativeSelectOption>
              <NativeSelectOption value="month">Past month</NativeSelectOption>
            </NativeSelect>
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 24, 12, 38]} rows={apiRows} />
        <DsParagraph className="mt-3">
          All remaining native select attributes are forwarded to the select
          element; className styles the positioning wrapper.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
