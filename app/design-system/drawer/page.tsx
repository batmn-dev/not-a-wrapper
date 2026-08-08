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
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import type { Metadata } from "next"

const defaultCode = `import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"

export function DrawerDefault() {
  return (
    <Drawer>
      <DrawerTrigger render={<Button variant="outline" />}>
        Open drawer
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Move goal</DrawerTitle>
          <DrawerDescription>
            Set your daily activity goal.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DrawerClose render={<Button />}>Submit</DrawerClose>
          <DrawerClose render={<Button variant="outline" />}>
            Cancel
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}`

const directionCode = `import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"

export function DrawerRight() {
  return (
    <Drawer direction="right">
      <DrawerTrigger render={<Button variant="outline" />}>
        Open from right
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Right drawer</DrawerTitle>
          <DrawerDescription>
            Side drawers skip the drag handle and behave like a sheet with
            drag-to-dismiss.
          </DrawerDescription>
        </DrawerHeader>
      </DrawerContent>
    </Drawer>
  )
}`

const apiRows = [
  {
    prop: "direction",
    type: '"top" | "bottom" | "left" | "right"',
    defaultValue: '"bottom"',
    description:
      "Edge the drawer slides in from and the axis it can be dragged along.",
  },
  {
    prop: "open / onOpenChange",
    type: "boolean / (open) => void",
    defaultValue: "—",
    description: "Controlled open state and its change handler, on the root.",
  },
  {
    prop: "dismissible",
    type: "boolean",
    defaultValue: "true",
    description:
      "When false, dragging and outside interaction cannot close the drawer.",
  },
  {
    prop: "modal",
    type: "boolean",
    defaultValue: "true",
    description: "Blocks interaction with the rest of the page while open.",
  },
  {
    prop: "snapPoints",
    type: "(number | string)[]",
    defaultValue: "—",
    description:
      "Heights the drawer can rest at, as viewport fractions or px values.",
  },
] as const

export const metadata: Metadata = {
  title: "Drawer | Design System",
  description:
    "Documentation and usage for the Not A Wrapper Drawer component.",
}

export default function DrawerPage() {
  const drawerSource = readComponentSource("components/ui/drawer.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="drawer"
        title="Drawer"
        description="Draggable panel built on vaul-base. Prefer it over Sheet on touch surfaces, where swipe-to-dismiss is the expected gesture."
      />

      <DsSection
        id="default"
        title="Default"
        description="Slides up from the bottom with a drag handle. Drag down or click the backdrop to dismiss."
      >
        <ComponentPreview code={defaultCode} sourceCode={drawerSource}>
          <Drawer>
            <DrawerTrigger render={<Button variant="outline" />}>
              Open drawer
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Move goal</DrawerTitle>
                <DrawerDescription>
                  Set your daily activity goal.
                </DrawerDescription>
              </DrawerHeader>
              <DrawerFooter>
                <DrawerClose render={<Button />}>Submit</DrawerClose>
                <DrawerClose render={<Button variant="outline" />}>
                  Cancel
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="direction"
        title="Direction"
        description="The direction prop on the root anchors the drawer to any viewport edge. The drag handle only renders for bottom drawers."
      >
        <ComponentPreview code={directionCode} sourceCode={drawerSource}>
          <Drawer direction="right">
            <DrawerTrigger render={<Button variant="outline" />}>
              Open from right
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Right drawer</DrawerTitle>
                <DrawerDescription>
                  Side drawers skip the drag handle and behave like a sheet
                  with drag-to-dismiss.
                </DrawerDescription>
              </DrawerHeader>
            </DrawerContent>
          </Drawer>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[22, 30, 12, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining vaul-base Root props (snap point control, scale background,
          nested drawers) are forwarded from the Drawer wrapper. DrawerContent
          renders its own portal and overlay.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
