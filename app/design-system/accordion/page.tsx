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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import type { Metadata } from "next"

const defaultCode = `import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

export function AccordionDefault() {
  return (
    <Accordion defaultValue={["item-1"]} className="w-72">
      <AccordionItem value="item-1">
        <AccordionTrigger>Is it accessible?</AccordionTrigger>
        <AccordionContent>
          Yes. It renders a header/button pair with the WAI-ARIA
          accordion semantics.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Is it styled?</AccordionTrigger>
        <AccordionContent>
          Yes. Items draw a divider and the chevron rotates when a
          panel opens.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Is it animated?</AccordionTrigger>
        <AccordionContent>
          Yes. Panels expand and collapse with the shared collapsible
          animation.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}`

const apiRows = [
  {
    prop: "defaultValue",
    type: "any[]",
    defaultValue: "[]",
    description: "Values of the items that start open when uncontrolled.",
  },
  {
    prop: "value / onValueChange",
    type: "any[] / (value) => void",
    defaultValue: "—",
    description:
      "Controlled open items and the change handler, on the Accordion root.",
  },
  {
    prop: "openMultiple",
    type: "boolean",
    defaultValue: "true",
    description:
      "Whether several items may be open at once. Set false for a classic single-open accordion.",
  },
  {
    prop: "disabled",
    type: "boolean",
    defaultValue: "false",
    description:
      "Disables the whole accordion; also available per AccordionItem.",
  },
  {
    prop: "AccordionItem value",
    type: "any",
    defaultValue: "—",
    description: "Identifies the item inside the root's value array.",
  },
  {
    prop: "AccordionTrigger children",
    type: "ReactNode",
    defaultValue: "—",
    description:
      "Trigger label. The rotating chevron icon is appended automatically.",
  },
] as const

export const metadata: Metadata = {
  title: "Accordion | Design System",
  description:
    "Base UI accordion with divider styling, rotating chevron, and the shared collapsible animation.",
}

export default function AccordionPage() {
  const accordionSource = readComponentSource("components/ui/accordion.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="accordion"
        title="Accordion"
        description="A set of vertically stacked, individually collapsible sections built on the Base UI Accordion primitive."
      />

      <DsSection
        id="default"
        title="Default"
        description="Items divide with a border and drop it on the last item. Open state is an array of item values — multiple items may be open at once unless openMultiple is disabled."
      >
        <ComponentPreview code={defaultCode} sourceCode={accordionSource}>
          <Accordion defaultValue={["item-1"]} className="w-72">
            <AccordionItem value="item-1">
              <AccordionTrigger>Is it accessible?</AccordionTrigger>
              <AccordionContent>
                Yes. It renders a header/button pair with the WAI-ARIA
                accordion semantics.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2">
              <AccordionTrigger>Is it styled?</AccordionTrigger>
              <AccordionContent>
                Yes. Items draw a divider and the chevron rotates when a panel
                opens.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-3">
              <AccordionTrigger>Is it animated?</AccordionTrigger>
              <AccordionContent>
                Yes. Panels expand and collapse with the shared collapsible
                animation.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[24, 24, 12, 40]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Accordion props (orientation, loop,
          keepMounted, and per-part className/render) are forwarded from each
          wrapper.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
