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
import { SonnerPresetsDemo } from "./demos/sonner-presets-demo"
import { ToastActionDemo } from "./demos/toast-action-demo"
import { ToastStatusDemo } from "./demos/toast-status-demo"

const toasterCode = `// app/layout.tsx — mounted once for the whole app
import { Toaster } from "@/components/ui/sonner"

<Toaster />

// Sonner's preset toasts pick up the themed icons and popover tokens
import { toast } from "sonner"

toast.success("Settings saved")
toast.info("A new version is available")
toast.error("Something went wrong")`

const apiRows = [
  {
    prop: "title",
    type: "string",
    defaultValue: "—",
    description: "Primary message line of the toast.",
  },
  {
    prop: "description",
    type: "string",
    defaultValue: "—",
    description: "Optional muted second line under the title.",
  },
  {
    prop: "status",
    type: '"error" | "info" | "success" | "warning"',
    defaultValue: "—",
    description:
      "Optional leading status icon (error, info, and success render an icon).",
  },
  {
    prop: "button",
    type: "{ label: string; onClick: () => void }",
    defaultValue: "—",
    description:
      "Optional trailing action button; the toast dismisses itself after the click.",
  },
] as const

export const metadata: Metadata = {
  title: "Toast | Design System",
  description:
    "Documentation for the Not A Wrapper toast system: the custom toast() renderer and the themed Sonner Toaster behind it.",
}

export default function ToastPage() {
  const toastSource = readComponentSource("components/ui/toast.tsx")
  const statusCode = readComponentSource(
    "app/design-system/toast/demos/toast-status-demo.tsx"
  )
  const actionCode = readComponentSource(
    "app/design-system/toast/demos/toast-action-demo.tsx"
  )
  const sonnerSource = readComponentSource("components/ui/sonner.tsx")

  return (
    <DsPage>
      <DsPageHeader
        slug="toast"
        title="Toast"
        description="One toast system in two halves: toast() renders the app's custom popover-styled toast through Sonner, and the Toaster provider in the root layout hosts it."
      />

      <DsSection
        id="status"
        title="Title, description, and status"
        description="toast() shows the custom card top-center. status picks the leading icon; title and description fill the two text lines."
      >
        <ComponentPreview code={statusCode} sourceCode={toastSource}>
          <ToastStatusDemo />
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="action"
        title="Action button"
        description="button renders a trailing secondary action; clicking it runs the handler and dismisses the toast."
      >
        <ComponentPreview code={actionCode} sourceCode={toastSource}>
          <ToastActionDemo />
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="toaster"
        title="Toaster provider"
        description="The Toaster in app/layout.tsx wraps Sonner with the app theme, remixicon status icons, and popover tokens — Sonner's own presets (toast.success, toast.error, …) inherit them."
      >
        <ComponentPreview code={toasterCode} sourceCode={sonnerSource}>
          <SonnerPresetsDemo />
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[16, 34, 10, 40]} rows={apiRows} />
        <DsParagraph className="mt-3">
          toast() options above are the custom renderer&apos;s API
          (components/ui/toast.tsx). The Toaster wrapper forwards all Sonner
          ToasterProps (position, duration, richColors, …); mount it once — the
          root layout already does.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
