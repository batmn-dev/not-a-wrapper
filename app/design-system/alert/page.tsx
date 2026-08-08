import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { RiErrorWarningLine, RiInformationLine } from "@remixicon/react"
import type { Metadata } from "next"

const defaultCode = `import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { RiInformationLine } from "@remixicon/react"

export function AlertDefault() {
  return (
    <Alert>
      <RiInformationLine />
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>
        Model responses may take longer while the provider is degraded.
      </AlertDescription>
    </Alert>
  )
}`

const destructiveCode = `import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { RiErrorWarningLine } from "@remixicon/react"

export function AlertDestructive() {
  return (
    <Alert variant="destructive">
      <RiErrorWarningLine />
      <AlertTitle>Unable to save API key</AlertTitle>
      <AlertDescription>
        The key failed validation. Check it in your provider dashboard and try
        again.
      </AlertDescription>
    </Alert>
  )
}`

const apiRows = [
  {
    prop: "variant",
    type: '"default" | "destructive"',
    defaultValue: '"default"',
    description:
      "Visual tone on the Alert root. Destructive tints the title, icon, and description toward the destructive color.",
  },
  {
    prop: "AlertTitle",
    type: "div props",
    defaultValue: "—",
    description: "Single-line heading, clamped to one line.",
  },
  {
    prop: "AlertDescription",
    type: "div props",
    defaultValue: "—",
    description:
      "Muted body copy below the title; stacks multiple children with a small gap.",
  },
] as const

export const metadata: Metadata = {
  title: "Alert | Design System",
  description:
    "Documentation and visual variants for the Not A Wrapper Alert component.",
}

export default function AlertPage() {
  const alertSource = readComponentSource("components/ui/alert.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="alert"
        title="Alert"
        description="Inline callout with an optional leading icon, a title, and muted description text."
      />

      <DsSection
        id="default"
        title="Default"
        description="A direct svg child snaps into the leading icon column; without one the text spans the full width."
      >
        <ComponentPreview code={defaultCode} sourceCode={alertSource}>
          <Alert>
            <RiInformationLine />
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>
              Model responses may take longer while the provider is degraded.
            </AlertDescription>
          </Alert>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="destructive"
        title="Destructive"
        description="For errors and irreversible outcomes. The card surface stays neutral while the text and icon carry the destructive color."
      >
        <ComponentPreview code={destructiveCode} sourceCode={alertSource}>
          <Alert variant="destructive">
            <RiErrorWarningLine />
            <AlertTitle>Unable to save API key</AlertTitle>
            <AlertDescription>
              The key failed validation. Check it in your provider dashboard
              and try again.
            </AlertDescription>
          </Alert>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[20, 26, 14, 40]} rows={apiRows} />
        <DsParagraph className="mt-3">
          The root renders a div with role=alert and forwards all standard div
          attributes.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
