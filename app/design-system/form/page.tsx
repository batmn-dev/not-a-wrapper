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
import { FormDemo } from "./demos"

const formCode = `import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useForm } from "react-hook-form"

export function ProfileForm() {
  const form = useForm({ defaultValues: { username: "" } })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex w-72 flex-col gap-5"
      >
        <FormField
          control={form.control}
          name="username"
          rules={{ required: "Username is required." }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder="ada" {...field} />
              </FormControl>
              <FormDescription>Your public handle.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="self-start">
          Submit
        </Button>
      </form>
    </Form>
  )
}`

const apiRows = [
  {
    prop: "Form",
    type: "UseFormReturn (spread)",
    defaultValue: "—",
    description:
      "Alias of react-hook-form's FormProvider; spread the useForm() return into it.",
  },
  {
    prop: "FormField control / name / rules",
    type: "ControllerProps",
    defaultValue: "—",
    description:
      "Controller wrapper that also publishes the field name so descendants can read its state.",
  },
  {
    prop: "FormField render",
    type: "({ field, fieldState }) => ReactNode",
    defaultValue: "—",
    description:
      "Renders the field UI; spread field into the control for value, onChange, and ref wiring.",
  },
  {
    prop: "FormControl children",
    type: "ReactElement",
    defaultValue: "—",
    description:
      "Single element that receives the generated id, aria-describedby, and aria-invalid via Base UI useRender — no extra DOM node.",
  },
  {
    prop: "FormLabel / FormDescription / FormMessage",
    type: "element props",
    defaultValue: "—",
    description:
      "Label, help text, and error line auto-linked to the control's ids. FormMessage renders the field error, or its children when there is none.",
  },
  {
    prop: "useFormField()",
    type: "() => field state + ids",
    defaultValue: "—",
    description:
      "Hook for custom field chrome inside a FormField/FormItem: name, error, and the generated element ids.",
  },
] as const

export const metadata: Metadata = {
  title: "Form | Design System",
  description:
    "react-hook-form bindings that wire labels, descriptions, and error messages to controls with generated ids and aria attributes.",
}

export default function FormPage() {
  const formSource = readComponentSource("components/ui/form.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="form"
        title="Form"
        description="react-hook-form bindings: FormField wraps Controller, and FormItem generates the ids that link label, control, description, and error message with the right aria attributes."
      />

      <DsSection
        id="default"
        title="Default"
        description="Submit with the field empty to see validation flow through: FormMessage renders the error and FormControl flips the input's aria-invalid, which draws the destructive ring."
      >
        <ComponentPreview code={formCode} sourceCode={formSource}>
          <FormDemo />
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[30, 26, 8, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Validation, defaults, and submission behavior all come from the
          useForm hook in react-hook-form; these components only own the markup
          and accessibility wiring.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
