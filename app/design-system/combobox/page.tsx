import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import type { Metadata } from "next"
import { ComboboxChipsDemo } from "./demos/combobox-chips-demo"
import { ComboboxDefaultDemo } from "./demos/combobox-default-demo"

const apiRows = [
  {
    prop: "items",
    type: "T[]",
    defaultValue: "—",
    description:
      "Options on the Combobox root; filtering happens automatically and ComboboxList can take a render function per item.",
  },
  {
    prop: "value / onValueChange",
    type: "T | T[] / (value) => void",
    defaultValue: "—",
    description:
      "Controlled selection (array when multiple). Use defaultValue when uncontrolled.",
  },
  {
    prop: "multiple",
    type: "boolean",
    defaultValue: "false",
    description:
      "Allows several selections; pair with ComboboxChips and ComboboxValue.",
  },
  {
    prop: "ComboboxInput showTrigger / showClear",
    type: "boolean / boolean",
    defaultValue: "true / false",
    description:
      "Toggles the dropdown-arrow trigger and the clear button in the input's trailing addon.",
  },
  {
    prop: "ComboboxContent side / align / anchor",
    type: "Positioner props",
    defaultValue: '"bottom" / "start"',
    description:
      "Popup placement; pass the useComboboxAnchor ref as anchor to position against a chips container.",
  },
  {
    prop: "ComboboxChip showRemove",
    type: "boolean",
    defaultValue: "true",
    description: "Renders the chip's remove button.",
  },
] as const

export const metadata: Metadata = {
  title: "Combobox | Design System",
  description:
    "Filterable Base UI combobox with input-group chrome, single and multi-select chips modes.",
}

export default function ComboboxPage() {
  const comboboxSource = readComponentSource("components/ui/combobox.tsx")
  const defaultCode = readComponentSource(
    "app/design-system/combobox/demos/combobox-default-demo.tsx"
  )
  const chipsCode = readComponentSource(
    "app/design-system/combobox/demos/combobox-chips-demo.tsx"
  )

  return (
    <DsPage>
      <DsPageHeader
        slug="combobox"
        title="Combobox"
        description="Filter-as-you-type selection built on Base UI: the input wears Input Group chrome, and a multiple mode renders selections as removable chips."
      />

      <DsSection
        id="default"
        title="Default"
        description="Type to filter the items list; ComboboxEmpty shows when nothing matches. The trailing arrow opens the full list without filtering."
      >
        <ComponentPreview code={defaultCode} sourceCode={comboboxSource}>
          <ComboboxDefaultDemo />
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="chips"
        title="Multiple with chips"
        description="multiple keeps the popup open across selections and renders each value as a removable chip; the popup anchors to the chips container via useComboboxAnchor."
      >
        <ComponentPreview code={chipsCode} sourceCode={comboboxSource}>
          <ComboboxChipsDemo />
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[30, 24, 12, 34]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Combobox is the unwrapped Base UI root; remaining root props
          (onOpenChange, openOnInputClick, filter, disabled) pass straight
          through, and ComboboxGroup, ComboboxLabel, ComboboxCollection, and
          ComboboxSeparator organize larger lists.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
