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
import { ChartBarDemo } from "./demos/chart-bar-demo"

const apiRows = [
  {
    prop: "ChartContainer config",
    type: "ChartConfig",
    defaultValue: "—",
    description:
      "Per-series label, optional icon, and color (or per-theme colors). Each key is exposed inside the chart as --color-<key>.",
  },
  {
    prop: "ChartContainer children",
    type: "Recharts chart element",
    defaultValue: "—",
    description:
      "A single Recharts chart (BarChart, LineChart, …) rendered inside a ResponsiveContainer.",
  },
  {
    prop: "ChartTooltipContent indicator",
    type: '"dot" | "line" | "dashed"',
    defaultValue: '"dot"',
    description: "Shape of the per-series color marker inside the tooltip.",
  },
  {
    prop: "ChartTooltipContent hideLabel / hideIndicator",
    type: "boolean",
    defaultValue: "false",
    description: "Drop the tooltip heading or the color markers.",
  },
  {
    prop: "ChartTooltipContent nameKey / labelKey",
    type: "string",
    defaultValue: "—",
    description:
      "Override which payload key resolves the series name and the tooltip label in the config.",
  },
  {
    prop: "ChartLegendContent hideIcon",
    type: "boolean",
    defaultValue: "false",
    description: "Hide the color swatch next to each legend entry.",
  },
] as const

export const metadata: Metadata = {
  title: "Chart | Design System",
  description:
    "Recharts wrapper with themed containers, tooltips, and legends driven by a single ChartConfig.",
}

export default function ChartPage() {
  const chartSource = readComponentSource("components/ui/chart.tsx")
  const barCode = readComponentSource(
    "app/design-system/chart/demos/chart-bar-demo.tsx"
  )

  return (
    <DsPage>
      <DsPageHeader
        slug="chart"
        title="Chart"
        description="Recharts wrapper: ChartContainer themes the chart from one ChartConfig, and ChartTooltip/ChartLegend swap in styled content components."
      />

      <DsSection
        id="bar"
        title="Bar chart"
        description="ChartConfig maps each data series to a label and color; the container exposes those colors as --color-<key> so Recharts elements reference them without hardcoding, and they re-theme in dark mode."
      >
        <ComponentPreview code={barCode} sourceCode={chartSource}>
          <ChartBarDemo />
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[26, 22, 12, 40]} rows={apiRows} />
        <DsParagraph className="mt-3">
          ChartTooltip and ChartLegend are the raw Recharts Tooltip and Legend;
          pass ChartTooltipContent and ChartLegendContent as their content prop.
          Per-theme colors use config theme: {"{ light, dark }"} instead of
          color.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
