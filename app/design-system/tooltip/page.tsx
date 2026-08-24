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
import { Kbd } from "@/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipMultiline,
  TooltipShortcut,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Metadata } from "next"

const defaultCode = `import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function TooltipDefault() {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" />}>
        Hover me
      </TooltipTrigger>
      <TooltipContent>Add to library</TooltipContent>
    </Tooltip>
  )
}`

const multilineCode = `import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipMultiline,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function TooltipWithMultipleLines() {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" />}>
        Retry
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <TooltipMultiline>
          <span>Try again...</span>
          <span className="text-[var(--text-tertiary)]">Using GPT-5.5</span>
        </TooltipMultiline>
      </TooltipContent>
    </Tooltip>
  )
}`

const shortcutCode = `import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipShortcut,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function TooltipWithShortcut() {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" />}>
        Search
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <TooltipShortcut label="Search chats">
          <Kbd label="Command">⌘</Kbd>
          <Kbd>K</Kbd>
        </TooltipShortcut>
      </TooltipContent>
    </Tooltip>
  )
}`

const apiRows = [
  {
    prop: "TooltipProvider delay",
    type: "fixed",
    defaultValue: "0ms",
    description:
      "Fixed by the primitive so every tooltip opens immediately and call sites cannot introduce timing drift.",
  },
  {
    prop: "Tooltip disableHoverablePopup",
    type: "boolean",
    defaultValue: "true",
    description:
      "Closes the tooltip when the pointer leaves the trigger instead of allowing it to move onto the popup.",
  },
  {
    prop: "open / onOpenChange",
    type: "boolean / (open, eventDetails) => void",
    defaultValue: "—",
    description: "Controlled open state and its change handler, on the root.",
  },
  {
    prop: "TooltipContent side",
    type: '"top" | "right" | "bottom" | "left" | ...',
    defaultValue: '"top"',
    description: "Which side of the trigger the tooltip is placed on.",
  },
  {
    prop: "TooltipContent variant",
    type: '"default" | "outline"',
    defaultValue: '"default"',
    description:
      "Dark tooltip surface, or the popover surface with a shadow border.",
  },
  {
    prop: "TooltipContent hideArrow",
    type: "boolean",
    defaultValue: "true",
    description: "Hides the caret pointing at the trigger.",
  },
  {
    prop: "TooltipMultiline",
    type: 'ComponentProps<"span">',
    defaultValue: "—",
    description:
      "Stacks related lines and applies the smaller multiline surface radius.",
  },
  {
    prop: "TooltipShortcut label / detail",
    type: "ReactNode / ReactNode",
    defaultValue: "—",
    description:
      "One accessible action phrase with Kbd children rendered in the shared shortcut capsule. Keys hide on coarse pointers.",
  },
] as const

export const metadata: Metadata = {
  title: "Tooltip | Design System",
  description:
    "Documentation and usage for the Not A Wrapper Tooltip component.",
}

export default function TooltipPage() {
  const tooltipSource = readComponentSource("components/ui/tooltip.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="tooltip"
        title="Tooltip"
        description="Base UI tooltip with the app's dark surface, an outline variant, and a shortcut composition for keyboard hints."
      />

      <DsSection
        id="default"
        title="Default"
        description="Opens immediately from pointer hover or keyboard focus. Use it only for supplementary hints; the UI must work without ever reading a tooltip."
      >
        <ComponentPreview code={defaultCode} sourceCode={tooltipSource}>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" />}>
              Hover me
            </TooltipTrigger>
            <TooltipContent>Add to library</TooltipContent>
          </Tooltip>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="multiline"
        title="Multiple lines"
        description="TooltipMultiline stacks related details and switches the surface from the single-line pill to a smaller corner radius."
      >
        <ComponentPreview code={multilineCode} sourceCode={tooltipSource}>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" />}>
              Retry
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <TooltipMultiline>
                <span>Try again...</span>
                <span className="text-[var(--text-tertiary)]">
                  Using GPT-5.5
                </span>
              </TooltipMultiline>
            </TooltipContent>
          </Tooltip>
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="shortcut"
        title="Shortcut"
        description="TooltipShortcut announces the action and keys as one phrase, then renders the keys in the shared 18px shortcut capsule. Keys hide automatically on touch devices."
      >
        <ComponentPreview code={shortcutCode} sourceCode={tooltipSource}>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" />}>
              Search
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <TooltipShortcut label="Search chats">
                <Kbd label="Command">⌘</Kbd>
                <Kbd>K</Kbd>
              </TooltipShortcut>
            </TooltipContent>
          </Tooltip>
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[28, 26, 12, 34]} rows={apiRows} />
        <DsParagraph className="mt-3">
          Remaining Base UI Tooltip props are forwarded from each wrapper.
          TooltipContent renders its own portal and positioner. TooltipProvider
          fixes the opening delay at 0ms for every tooltip.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
