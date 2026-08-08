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
import { ChartBarDemo } from "./demos"

const barCode = `import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"

const chartData = [
  { month: "Jan", desktop: 186, mobile: 80 },
  { month: "Feb", desktop: 305, mobile: 200 },
  { month: "Mar", desktop: 237, mobile: 120 },
  { month: "Apr", desktop: 73, mobile: 190 },
  { month: "May", desktop: 209, mobile: 130 },
  { month: "Jun", desktop: 214, mobile: 140 },
]

const chartConfig = {
  desktop: { label: "Desktop", color: "var(--chart-1)" },
  mobile: { label: "Mobile", color: "var(--chart-2)" },
} satisfies ChartConfig

export function ChartBarDemo() {
  return (
    <ChartContainer config={chartConfig} className="w-full max-w-md">
      <BarChart accessibilityLayer data={chartData}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="month"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
        />
        <ChartTooltip
          cursor={false}
          content={({ content: _content, ...props }) => (
            <ChartTooltipContent {...props} />
          )}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="desktop" fill="var(--color-desktop)" radius={4} />
        <Bar dataKey="mobile" fill="var(--color-mobile)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}`

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
