import { ComponentPreview } from "@/app/design-system/_components/component-preview"
import {
  DsApiTable,
  DsPage,
  DsPageHeader,
  DsParagraph,
  DsSection,
} from "@/app/design-system/_components/ds-page"
import { readComponentSource } from "@/app/design-system/_lib/component-source"
import { Loader } from "@/components/ui/loader"
import type { Metadata } from "next"

const spinnerVariants = [
  "circular",
  "classic",
  "pulse",
  "pulse-dot",
  "dots",
  "typing",
  "wave",
  "bars",
  "terminal",
] as const

const variantsCode = `import { Loader } from "@/components/ui/loader"

const variants = [
  "circular", "classic", "pulse", "pulse-dot", "dots",
  "typing", "wave", "bars", "terminal",
] as const

export function LoaderVariants() {
  return (
    <div className="grid grid-cols-3 gap-x-10 gap-y-8">
      {variants.map((variant) => (
        <div key={variant} className="flex flex-col items-center gap-3">
          <div className="flex h-6 items-center">
            <Loader variant={variant} />
          </div>
          <span className="text-muted-foreground font-mono text-xs">
            {variant}
          </span>
        </div>
      ))}
    </div>
  )
}`

const textCode = `import { Loader } from "@/components/ui/loader"

export function LoaderText() {
  return (
    <div className="flex flex-col items-center gap-6">
      <Loader variant="text-blink" text="Thinking" />
      <Loader variant="text-shimmer" text="Generating response" />
      <Loader variant="text-shimmer" text="Streaming" showCaret />
      <Loader variant="loading-dots" text="Loading" />
    </div>
  )
}`

const apiRows = [
  {
    prop: "variant",
    type: '"circular" | "classic" | "pulse" | "pulse-dot" | "dots" | "typing" | "wave" | "bars" | "terminal" | "text-blink" | "text-shimmer" | "loading-dots" | "chat"',
    defaultValue: '"circular"',
    description: "Which loading animation to render.",
  },
  {
    prop: "size",
    type: '"sm" | "md" | "lg"',
    defaultValue: '"md"',
    description: "Scales the glyph (or text) for every variant except chat.",
  },
  {
    prop: "text",
    type: "string",
    defaultValue: '"Thinking"',
    description:
      "Label for the text variants: text-blink, text-shimmer, and loading-dots.",
  },
  {
    prop: "showCaret",
    type: "boolean",
    defaultValue: "false",
    description:
      "text-shimmer only: appends a streaming indicator after the label.",
  },
  {
    prop: "streamingIndicatorVariant",
    type: "StreamingIndicatorVariant",
    defaultValue: '"none"',
    description:
      "Which streaming indicator the caret renders: caret, rotating-glyph, wave-segment, slide-dot-trail, pulse-dot, shimmer-underscore, or soft-glow-marker.",
  },
] as const

export const metadata: Metadata = {
  title: "Loader | Design System",
  description:
    "Unified loading indicator with thirteen variants, from spinners to streaming text shimmers.",
}

export default function LoaderPage() {
  const loaderSource = readComponentSource("components/ui/loader.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="loader"
        title="Loader"
        description="One Loader, thirteen variants: CSS spinners, dot and bar rhythms, and the text shimmers used while a response streams."
      />

      <DsSection
        id="variants"
        title="Variants"
        description="The glyph variants. All are pure CSS animations on the primary color and carry a screen-reader-only Loading label."
      >
        <ComponentPreview code={variantsCode} sourceCode={loaderSource}>
          <div className="grid grid-cols-3 gap-x-10 gap-y-8">
            {spinnerVariants.map((variant) => (
              <div key={variant} className="flex flex-col items-center gap-3">
                <div className="flex h-6 items-center">
                  <Loader variant={variant} />
                </div>
                <span className="text-muted-foreground font-mono text-xs">
                  {variant}
                </span>
              </div>
            ))}
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="text"
        title="Text variants"
        description="Label-bearing variants for longer waits. text-shimmer is the assistant's thinking indicator; showCaret appends a streaming indicator after the label."
      >
        <ComponentPreview code={textCode} sourceCode={loaderSource}>
          <div className="flex flex-col items-center gap-6">
            <Loader variant="text-blink" text="Thinking" />
            <Loader variant="text-shimmer" text="Generating response" />
            <Loader variant="text-shimmer" text="Streaming" showCaret />
            <Loader variant="loading-dots" text="Loading" />
          </div>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[22, 34, 12, 32]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Each variant is also exported standalone (CircularLoader,
          TextShimmerLoader, StreamingCaret, …) when a call site wants the
          concrete component instead of the variant switch.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
