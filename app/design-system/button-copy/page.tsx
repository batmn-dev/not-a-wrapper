import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { ButtonCopy } from "@/components/ui/button-copy"
import type { Metadata } from "next"

const defaultCode = `import { ButtonCopy } from "@/components/ui/button-copy"

export function ButtonCopyDefault() {
  return (
    <div className="flex items-center gap-6">
      <ButtonCopy code="bun add @base-ui/react" />
      <ButtonCopy
        code={() => document.querySelector("pre")?.innerText ?? ""}
        label="Copy code"
      />
    </div>
  )
}`

const apiRows = [
  {
    prop: "code",
    type: "string | (() => string)",
    defaultValue: "—",
    description:
      "The text written to the clipboard. Pass a function to resolve it lazily at click time.",
  },
  {
    prop: "label",
    type: "string",
    defaultValue: '"Copy"',
    description:
      "Tooltip and accessible name at rest; both flip to Copied for a second after a click.",
  },
  {
    prop: "variant",
    type: '"code" | "table"',
    defaultValue: '"code"',
    description:
      "code is the round chip for code-block headers; table is the hover-revealed chip that markdown tables show inside a group/markdown-table container.",
  },
] as const

export const metadata: Metadata = {
  title: "Button Copy | Design System",
  description:
    "Copy-to-clipboard icon button with tooltip and transient Copied confirmation.",
}

export default function ButtonCopyPage() {
  const buttonCopySource = readComponentSource("components/ui/button-copy.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="button-copy"
        title="Button Copy"
        description="Copy-to-clipboard icon button with a tooltip that flips to Copied for a second after the click, used on code blocks and markdown tables."
      />

      <DsSection
        id="default"
        title="Default"
        description="The code variant: a round icon chip that copies its code value and swaps the copy glyph for a check while the confirmation shows."
      >
        <ComponentPreview code={defaultCode} sourceCode={buttonCopySource}>
          <div className="flex items-center gap-6">
            <ButtonCopy code="bun add @base-ui/react" />
            <ButtonCopy code="npx create-next-app@latest" label="Copy command" />
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[14, 26, 14, 46]} rows={apiRows} />
        <DsParagraph className="mt-3">
          The table variant stays invisible until its surrounding
          group/markdown-table container is hovered or focused (always visible
          on coarse pointers), so it only makes sense inside that context.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
