import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { Metadata } from "next"

const defaultCode = `import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function FieldDefault() {
  return (
    <FieldGroup className="w-72">
      <Field>
        <FieldLabel htmlFor="display-name">Display name</FieldLabel>
        <Input id="display-name" placeholder="Ada Lovelace" />
        <FieldDescription>Shown next to your messages.</FieldDescription>
      </Field>
      <Field data-invalid>
        <FieldLabel htmlFor="handle">Handle</FieldLabel>
        <Input id="handle" placeholder="@ada" aria-invalid />
        <FieldError>This handle is already taken.</FieldError>
      </Field>
    </FieldGroup>
  )
}`

const horizontalCode = `import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"

export function FieldHorizontal() {
  return (
    <FieldGroup className="w-72">
      <Field orientation="horizontal">
        <Checkbox id="email-updates" defaultChecked />
        <FieldContent>
          <FieldLabel htmlFor="email-updates">Email updates</FieldLabel>
          <FieldDescription>Product news, at most once a month.</FieldDescription>
        </FieldContent>
      </Field>
      <FieldSeparator />
      <Field orientation="horizontal">
        <Checkbox id="security-alerts" />
        <FieldContent>
          <FieldLabel htmlFor="security-alerts">Security alerts</FieldLabel>
          <FieldDescription>Sign-in and account changes.</FieldDescription>
        </FieldContent>
      </Field>
    </FieldGroup>
  )
}`

const apiRows = [
  {
    prop: "Field orientation",
    type: '"vertical" | "horizontal" | "responsive"',
    defaultValue: '"vertical"',
    description:
      "Stacks label over control, puts the control beside a FieldContent block, or switches at the @md container breakpoint.",
  },
  {
    prop: "Field data-invalid",
    type: "boolean",
    defaultValue: "—",
    description:
      "Paints the whole group destructive; pair with aria-invalid on the control.",
  },
  {
    prop: "FieldLabel",
    type: "Label props",
    defaultValue: "—",
    description:
      "Label wired for the field context; can wrap a whole Field to make a selectable card.",
  },
  {
    prop: "FieldError errors",
    type: "Array<{ message?: string }>",
    defaultValue: "—",
    description:
      "Deduplicates and renders error messages (a list when there are several). Children override the errors prop.",
  },
  {
    prop: "FieldLegend variant",
    type: '"legend" | "label"',
    defaultValue: '"legend"',
    description: "Legend sizing inside a FieldSet: base text or label-sized.",
  },
  {
    prop: "FieldSeparator children",
    type: "ReactNode",
    defaultValue: "—",
    description: "Optional inline text rendered over the separator rule.",
  },
] as const

export const metadata: Metadata = {
  title: "Field | Design System",
  description:
    "Layout primitives for form fields: label, control, description, and error composed with consistent spacing.",
}

export default function FieldPage() {
  const fieldSource = readComponentSource("components/ui/field.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="field"
        title="Field"
        description="Layout vocabulary for form fields: FieldGroup, Field, label, description, and error compose any control with consistent spacing and invalid styling."
      />

      <DsSection
        id="default"
        title="Default"
        description="Vertical fields inside a FieldGroup. FieldError plus data-invalid on the Field paints the label and message destructive."
      >
        <ComponentPreview code={defaultCode} sourceCode={fieldSource}>
          <FieldGroup className="w-72">
            <Field>
              <FieldLabel htmlFor="field-demo-display-name">
                Display name
              </FieldLabel>
              <Input id="field-demo-display-name" placeholder="Ada Lovelace" />
              <FieldDescription>Shown next to your messages.</FieldDescription>
            </Field>
            <Field data-invalid>
              <FieldLabel htmlFor="field-demo-handle">Handle</FieldLabel>
              <Input id="field-demo-handle" placeholder="@ada" aria-invalid />
              <FieldError>This handle is already taken.</FieldError>
            </Field>
          </FieldGroup>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="horizontal"
        title="Horizontal"
        description="orientation='horizontal' puts the control beside a FieldContent block that stacks the label and description — the usual shape for checkbox and switch rows."
      >
        <ComponentPreview code={horizontalCode} sourceCode={fieldSource}>
          <FieldGroup className="w-72">
            <Field orientation="horizontal">
              <Checkbox id="field-demo-email-updates" defaultChecked />
              <FieldContent>
                <FieldLabel htmlFor="field-demo-email-updates">
                  Email updates
                </FieldLabel>
                <FieldDescription>
                  Product news, at most once a month.
                </FieldDescription>
              </FieldContent>
            </Field>
            <FieldSeparator />
            <Field orientation="horizontal">
              <Checkbox id="field-demo-security-alerts" />
              <FieldContent>
                <FieldLabel htmlFor="field-demo-security-alerts">
                  Security alerts
                </FieldLabel>
                <FieldDescription>Sign-in and account changes.</FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[22, 26, 12, 40]} rows={apiRows} />
        <DsParagraph className="mt-3">
          FieldSet, FieldGroup, FieldContent, FieldTitle, and FieldDescription
          are styled containers that forward their standard element props.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
