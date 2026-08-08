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
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { Metadata } from "next"

const defaultCode = `import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

export function SheetDefault() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>
        Open sheet
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit profile</SheetTitle>
          <SheetDescription>
            Make changes to your profile here. Click save when you are done.
          </SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <SheetClose render={<Button />}>Save changes</SheetClose>
          <SheetClose render={<Button variant="outline" />}>
            Cancel
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}`

const sidesCode = `import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

const sides = ["top", "right", "bottom", "left"] as const

export function SheetSides() {
  return (
    <div className="grid grid-cols-2 gap-2">
      {sides.map((side) => (
        <Sheet key={side}>
          <SheetTrigger render={<Button variant="outline" />}>
            {side}
          </SheetTrigger>
          <SheetContent side={side}>
            <SheetHeader>
              <SheetTitle>Sheet from {side}</SheetTitle>
              <SheetDescription>
                This sheet slides in from the {side} edge.
              </SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      ))}
    </div>
  )
}`

const sides = ["top", "right", "bottom", "left"] as const

const apiRows = [
  {
    prop: "open / onOpenChange",
    type: "boolean / (open, eventDetails) => void",
    defaultValue: "—",
    description: "Controlled open state and its change handler, on the root.",
  },
  {
    prop: "SheetTrigger render",
    type: "ReactElement | render function",
    defaultValue: "—",
    description:
      "Composes the trigger onto another element, typically a Button.",
  },
  {
    prop: "SheetContent side",
    type: '"top" | "right" | "bottom" | "left"',
    defaultValue: '"right"',
    description: "Edge of the viewport the sheet slides in from.",
  },
  {
    prop: "SheetContent showCloseButton",
    type: "boolean",
    defaultValue: "true",
    description: "Renders the ghost close button in the top-right corner.",
  },
  {
    prop: "SheetContent overlayClassName",
    type: "string",
    defaultValue: "—",
    description: "Optional class merged onto the backdrop overlay.",
  },
] as const

export const metadata: Metadata = {
  title: "Sheet | Design System",
  description: "Documentation and usage for the Not A Wrapper Sheet component.",
}

export default function SheetPage() {
  const sheetSource = readComponentSource("components/ui/sheet.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="sheet"
        title="Sheet"
        description="Edge-anchored panel that slides over the page, built on the Base UI dialog with side variants and a scrim backdrop."
      />

      <DsSection
        id="default"
        title="Default"
        description="Slides in from the right. Header and footer pad their own content; the top-right close button ships by default."
      >
        <ComponentPreview code={defaultCode} sourceCode={sheetSource}>
          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>
              Open sheet
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Edit profile</SheetTitle>
                <SheetDescription>
                  Make changes to your profile here. Click save when you are
                  done.
                </SheetDescription>
              </SheetHeader>
              <SheetFooter>
                <SheetClose render={<Button />}>Save changes</SheetClose>
                <SheetClose render={<Button variant="outline" />}>
                  Cancel
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="sides"
        title="Sides"
        description="The side prop anchors the sheet to any viewport edge. Left and right sheets are full-height; top and bottom size to their content."
      >
        <ComponentPreview code={sidesCode} sourceCode={sheetSource}>
          <div className="grid grid-cols-2 gap-2">
            {sides.map((side) => (
              <Sheet key={side}>
                <SheetTrigger render={<Button variant="outline" />}>
                  {side}
                </SheetTrigger>
                <SheetContent side={side}>
                  <SheetHeader>
                    <SheetTitle>Sheet from {side}</SheetTitle>
                    <SheetDescription>
                      This sheet slides in from the {side} edge.
                    </SheetDescription>
                  </SheetHeader>
                </SheetContent>
              </Sheet>
            ))}
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 26, 12, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Dialog props are forwarded from each wrapper.
          SheetContent renders its own portal and overlay, so pages only
          compose the root, trigger, and content.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
