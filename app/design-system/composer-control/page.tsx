import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { ComposerControlMatrix } from "@/app/design-system/composer-control/_components/composer-control-matrix"
import type { Metadata } from "next"

const usageCode = `import { ComposerControl } from "@/components/ui/composer-control"
import { ComposerIconButton } from "@/components/ui/composer-icon-button"

export function ComposerActions() {
  return (
    <div className="flex items-center gap-2">
      <ComposerIconButton aria-label="Add attachment">…</ComposerIconButton>
      <ComposerControl aria-expanded={false}>Model</ComposerControl>
    </div>
  )
}`

export const metadata: Metadata = {
  title: "Composer Control | Design System",
  description:
    "Interaction-state matrix for secondary controls inside the unified Composer.",
}

export default function ComposerControlPage() {
  const sourceCode = [
    readComponentSource("components/ui/composer-control.tsx"),
    readComponentSource("components/ui/composer-icon-button.tsx"),
  ].join("\n\n")

  return (
    <DsPage>
      <DsPageHeader
        slug="composer-control"
        title="Composer Control"
        description="Secondary Composer actions with one shared hover, touch, open-state, tap-target, and scale contract."
      />

      <DsSection
        id="interaction-matrix"
        title="Interaction matrix"
        description="Use a mouse or touch device on the real controls. Open-state rows are held open so token behavior remains directly comparable."
      >
        <ComponentPreview code={usageCode} sourceCode={sourceCode}>
          <ComposerControlMatrix />
        </ComponentPreview>
      </DsSection>

      <DsParagraph className="mt-4">
        Hover-capable pointers receive the secondary hover token on hover.
        Touch-only input receives that token at rest and the secondary pressed
        token while active. The Button Module retains the verified scale
        animation in both modes.
      </DsParagraph>
    </DsPage>
  )
}
