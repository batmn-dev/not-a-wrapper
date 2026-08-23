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
  HELIX_VARIANTS,
  LATTICE_VARIANTS,
  LENS_VARIANTS,
  MORPH_VARIANTS,
  Orb,
  ORB_TASKS,
  RING_VARIANTS,
  type OrbVariant,
} from "@/components/ui/orb"
import type { Metadata } from "next"

const orbFamilies = [
  { name: "Lattice", variants: LATTICE_VARIANTS },
  { name: "Helix", variants: HELIX_VARIANTS },
  { name: "Ring", variants: RING_VARIANTS },
  { name: "Lens", variants: LENS_VARIANTS },
  { name: "Morph", variants: MORPH_VARIANTS },
] as const

const variantsCode = `import {
  HELIX_VARIANTS,
  LATTICE_VARIANTS,
  LENS_VARIANTS,
  MORPH_VARIANTS,
  Orb,
  RING_VARIANTS,
} from "@/components/ui/orb"

const families = [
  LATTICE_VARIANTS,
  HELIX_VARIANTS,
  RING_VARIANTS,
  LENS_VARIANTS,
  MORPH_VARIANTS,
]

export function OrbVariants() {
  return families.map((variants) => (
    <div key={variants[0]} className="grid grid-cols-5 gap-8">
      {variants.map((variant) => (
        <Orb key={variant} variant={variant} />
      ))}
    </div>
  ))
}`

const pillsCode = `import { Orb } from "@/components/ui/orb"

export function OrbPills() {
  return (
    <div className="flex flex-wrap gap-3">
      <Orb variant="S1" pill />
      <Orb variant="B2" label="Searching the web…" pill />
      <Orb variant="C4" label="Analyzing sources…" pill />
    </div>
  )
}`

const sizesCode = `import { Orb } from "@/components/ui/orb"

export function OrbSizes() {
  return (
    <div className="flex items-center gap-8">
      <Orb size={16} />
      <Orb size={20} />
      <Orb size={32} />
      <Orb size={48} />
    </div>
  )
}`

const apiRows = [
  {
    prop: "variant",
    type: "OrbVariant",
    defaultValue: '"S1"',
    description:
      "Selects one of 25 lattice, helix, ring, lens, or morph animations.",
  },
  {
    prop: "size",
    type: "number",
    defaultValue: "20",
    description: "Rendered width and height in pixels.",
  },
  {
    prop: "label",
    type: "string",
    defaultValue: "variant task",
    description:
      "Accessible label for the glyph and visible status text in pill mode.",
  },
  {
    prop: "pill",
    type: "boolean",
    defaultValue: "false",
    description: "Wraps the glyph and status label in a compact surface.",
  },
  {
    prop: "className / style",
    type: "string / CSSProperties",
    defaultValue: "—",
    description:
      "Applies to the root element for layout and custom-property overrides.",
  },
] as const

export const metadata: Metadata = {
  title: "Orb | Design System",
  description:
    "Animated activity indicators for agent thinking, searching, generating, and other in-progress states.",
}

function OrbVariantPreview({ variant }: { variant: OrbVariant }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex size-10 items-center justify-center">
        <Orb variant={variant} />
      </div>
      <span className="text-muted-foreground font-mono text-xs">{variant}</span>
      <span className="text-muted-foreground text-xs">
        {ORB_TASKS[variant]}
      </span>
    </div>
  )
}

export default function OrbPage() {
  const orbSource = readComponentSource("components/ui/orb.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="orb"
        title="Orb"
        description="Compact animated activity indicators for agent states, adapted from AICSS and mapped to the design system's semantic colors."
      />

      <DsSection
        id="variants"
        title="Variants"
        description="Five motion families cover 25 distinct agent states. Every glyph inherits the surrounding theme and exposes a meaningful accessible label."
      >
        <ComponentPreview code={variantsCode} sourceCode={orbSource}>
          <div className="grid w-full grid-cols-1 gap-8 sm:grid-cols-5">
            {orbFamilies.map((family) => (
              <div key={family.name} className="flex flex-col gap-6">
                <span className="text-center text-sm font-medium">
                  {family.name}
                </span>
                {family.variants.map((variant) => (
                  <OrbVariantPreview key={variant} variant={variant} />
                ))}
              </div>
            ))}
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="pills"
        title="Status pills"
        description="Pill mode pairs the animation with either the variant's default task or a custom status label."
      >
        <ComponentPreview code={pillsCode} sourceCode={orbSource}>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Orb variant="S1" pill />
            <Orb variant="B2" label="Searching the web…" pill />
            <Orb variant="C4" label="Analyzing sources…" pill />
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="sizes"
        title="Sizes"
        description="The 28-pixel geometry scales to any numeric size while preserving each animation's proportions."
      >
        <ComponentPreview code={sizesCode} sourceCode={orbSource}>
          <div className="flex items-center gap-8">
            <Orb size={16} />
            <Orb size={20} />
            <Orb size={32} />
            <Orb size={48} />
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[24, 24, 16, 36]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Motion is disabled automatically when the user prefers reduced motion.
          The component styles live in orb.module.css beside the primitive.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
