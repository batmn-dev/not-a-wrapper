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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { Metadata } from "next"

const defaultCode = `import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

export function AlertDialogDefault() {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" />}>
        Delete chat
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. The chat and all of its messages
            will be permanently deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
    description: "Opens the alert dialog initially when uncontrolled.",
  },
  {
    prop: "AlertDialogTrigger render",
    type: "ReactElement | render function",
    defaultValue: "—",
    description:
      "Composes the trigger onto another element, typically a Button.",
  },
  {
    prop: "AlertDialogAction",
    type: "Close props",
    defaultValue: "—",
    description:
      "Closes the dialog styled as the default button. Attach the confirm handler via onClick.",
  },
  {
    prop: "AlertDialogCancel",
    type: "Close props",
    defaultValue: "—",
    description: "Closes the dialog styled as an outline button.",
  },
] as const

export const metadata: Metadata = {
  title: "Alert Dialog | Design System",
  description:
    "Documentation and usage for the Not A Wrapper Alert Dialog component.",
}

export default function AlertDialogPage() {
  const alertDialogSource = readComponentSource(
    "components/ui/alert-dialog.tsx"
  )

  return (
    <DsPage>
      <DsPageHeader
        slug="alert-dialog"
        title="Alert Dialog"
        description="Interruptive confirmation dialog for destructive or irreversible actions, built on the Base UI alert dialog."
      />

      <DsSection
        id="default"
        title="Default"
        description="Unlike Dialog, there is no corner close button and clicking the backdrop does not dismiss — the user must pick Cancel or the action."
      >
        <ComponentPreview code={defaultCode} sourceCode={alertDialogSource}>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" />}>
              Delete chat
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. The chat and all of its
                  messages will be permanently deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[24, 26, 14, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Alert Dialog props are forwarded from each wrapper.
          AlertDialogAction and AlertDialogCancel are Close primitives styled
          with buttonVariants, so they accept className to restyle (for
          example a destructive action).
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
