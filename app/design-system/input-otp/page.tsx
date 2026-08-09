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
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import type { Metadata } from "next"

const defaultCode = `import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"

export function InputOTPDefault() {
  return (
    <InputOTP maxLength={6}>
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  )
}`

const separatorCode = `import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp"

export function InputOTPWithSeparator() {
  return (
    <InputOTP maxLength={6}>
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  )
}`

const apiRows = [
  {
    prop: "maxLength",
    type: "number",
    defaultValue: "—",
    description:
      "Required. Total number of characters; render one InputOTPSlot per index.",
  },
  {
    prop: "value / onChange",
    type: "string / (value) => void",
    defaultValue: "—",
    description:
      "Controlled value and change handler. Leave off for uncontrolled use.",
  },
  {
    prop: "pattern",
    type: "string",
    defaultValue: "—",
    description:
      "Regex string that keystrokes must match, e.g. REGEXP_ONLY_DIGITS from input-otp.",
  },
  {
    prop: "containerClassName",
    type: "string",
    defaultValue: "—",
    description:
      "Classes for the outer flex container (className styles the hidden input).",
  },
  {
    prop: "InputOTPSlot index",
    type: "number",
    defaultValue: "—",
    description:
      "Which character of the value this cell renders; also drives the active ring and fake caret.",
  },
  {
    prop: "disabled",
    type: "boolean",
    defaultValue: "false",
    description: "Disables input and dims the whole group.",
  },
] as const

export const metadata: Metadata = {
  title: "Input OTP | Design System",
  description:
    "One-time password input with individually styled character slots, built on input-otp.",
}

export default function InputOTPPage() {
  const inputOTPSource = readComponentSource("components/ui/input-otp.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="input-otp"
        title="Input OTP"
        description="Segmented one-time-code input: a single hidden input rendered as styled character slots, with an animated caret in the active cell."
      />

      <DsSection
        id="default"
        title="Default"
        description="Slots inside one InputOTPGroup fuse into a single control — only the outer corners round and inner borders collapse. Click in and type to see the active ring travel."
      >
        <ComponentPreview code={defaultCode} sourceCode={inputOTPSource}>
          <InputOTP maxLength={6}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="separator"
        title="With separator"
        description="Split the code into multiple groups with InputOTPSeparator between them — the common 3-3 verification-code shape."
      >
        <ComponentPreview code={separatorCode} sourceCode={inputOTPSource}>
          <InputOTP maxLength={6}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[22, 24, 12, 42]} rows={apiRows} />
        <DsParagraph className="mt-3">
          InputOTP forwards all remaining OTPInput props from the input-otp
          library, including textAlign, inputMode, and pasteTransformer.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
