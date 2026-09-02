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
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { Metadata } from "next"

const defaultCode = `import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog"

export function DialogDefault() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        Edit profile
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader
          title="Edit profile"
          description="Make changes to your profile here. Click save when you are done."
        />
        <DialogFooter
          secondaryButton={
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          }
          primaryButton={
            <DialogClose render={<Button />}>Save changes</DialogClose>
          }
        />
      </DialogContent>
    </Dialog>
  )
}`

const apiRows = [
  {
    prop: "open / onOpenChange",
    type: "boolean / (open, eventDetails) => void",
    defaultValue: "—",
    description: "Controlled open state and its change handler, on the root.",
  },
  {
    prop: "defaultOpen",
    type: "boolean",
    defaultValue: "false",
    description: "Opens the dialog initially when uncontrolled.",
  },
  {
    prop: "modal",
    type: 'boolean | "trap-focus"',
    defaultValue: "true",
    description:
      "Traps focus and scroll while open. Use trap-focus to keep outside interaction enabled.",
  },
  {
    prop: "DialogTrigger render",
    type: "ReactElement | render function",
    defaultValue: "—",
    description:
      "Composes the trigger onto another element, typically a Button.",
  },
  {
    prop: "DialogContent showCloseButton",
    type: "boolean",
    defaultValue: "true",
    description:
      "Renders the ghost close button in the top-right corner unless a titled DialogHeader owns the close control.",
  },
  {
    prop: "DialogContent size",
    type: '"normal" | "large" | "xlarge" | "fullscreen"',
    defaultValue: '"normal"',
    description: "Uses a shared responsive modal width or the full container.",
  },
  {
    prop: "DialogHeader title / description",
    type: "ReactNode",
    defaultValue: "—",
    description:
      "Builds the title region and owns the close affordance; DialogContent's default close stays suppressed while a titled header is mounted.",
  },
  {
    prop: "DialogHeader hideCloseButton",
    type: "boolean",
    defaultValue: "false",
    description:
      "Hides the titled header's close button. The header still owns the control, so no fallback close appears.",
  },
  {
    prop: "DialogCloseButton",
    type: "DialogPrimitive.Close props",
    defaultValue: "—",
    description:
      "Provides the shared 36px close affordance. Never auto-focuses unless autoFocus is passed.",
  },
  {
    prop: "DialogFooter button slots",
    type: "ReactNode",
    defaultValue: "—",
    description:
      "Places footer content and secondary/primary actions. Exclusive with children and showCloseButton, which belong to the plain children footer.",
  },
] as const

export const metadata: Metadata = {
  title: "Dialog | Design System",
  description:
    "Documentation and usage for the Not A Wrapper Dialog component.",
}

export default function DialogPage() {
  const dialogSource = readComponentSource("components/ui/dialog.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="dialog"
        title="Dialog"
        description="Modal window layered over the page, built on the Base UI dialog with a scrim backdrop and built-in close affordances."
      />

      <DsSection
        id="default"
        title="Default"
        description="Trigger, content with header and description, and a footer whose buttons close via DialogClose. The top-right close button ships by default."
      >
        <ComponentPreview code={defaultCode} sourceCode={dialogSource}>
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>
              Edit profile
            </DialogTrigger>
            <DialogContent showCloseButton={false}>
              <DialogHeader
                title="Edit profile"
                description="Make changes to your profile here. Click save when you are done."
              />
              <DialogFooter
                secondaryButton={
                  <DialogClose render={<Button variant="outline" />}>
                    Cancel
                  </DialogClose>
                }
                primaryButton={
                  <DialogClose render={<Button />}>Save changes</DialogClose>
                }
              />
            </DialogContent>
          </Dialog>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[24, 26, 14, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Dialog props are forwarded from each wrapper.
          DialogContent renders its own portal and overlay, so pages only
          compose the root, trigger, and content.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
