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
import { CalendarRangeDemo } from "./demos/calendar-range-demo"
import { CalendarSingleDemo } from "./demos/calendar-single-demo"

const apiRows = [
  {
    prop: "mode",
    type: '"single" | "multiple" | "range"',
    defaultValue: "—",
    description: "Selection model; drives the types of selected and onSelect.",
  },
  {
    prop: "selected / onSelect",
    type: "Date | Date[] | DateRange / handler",
    defaultValue: "—",
    description: "Controlled selection and its change handler, typed by mode.",
  },
  {
    prop: "captionLayout",
    type: '"label" | "dropdown" | "dropdown-months" | "dropdown-years"',
    defaultValue: '"label"',
    description:
      "Static month caption or dropdown navigation for month and year.",
  },
  {
    prop: "showOutsideDays",
    type: "boolean",
    defaultValue: "true",
    description: "Renders muted days from adjacent months to fill each week.",
  },
  {
    prop: "buttonVariant",
    type: 'Button "variant"',
    defaultValue: '"ghost"',
    description: "Button variant used for the previous/next month buttons.",
  },
  {
    prop: "numberOfMonths",
    type: "number",
    defaultValue: "1",
    description: "Months rendered side by side (stacked on small screens).",
  },
  {
    prop: "disabled",
    type: "Matcher | Matcher[]",
    defaultValue: "—",
    description: "Dates that cannot be selected, e.g. { before: new Date() }.",
  },
] as const

export const metadata: Metadata = {
  title: "Calendar | Design System",
  description:
    "Documentation and visual variants for the Not A Wrapper Calendar component.",
}

export default function CalendarPage() {
  const calendarSource = readComponentSource("components/ui/calendar.tsx")
  const singleCode = readComponentSource(
    "app/design-system/calendar/demos/calendar-single-demo.tsx"
  )
  const rangeCode = readComponentSource(
    "app/design-system/calendar/demos/calendar-range-demo.tsx"
  )

  return (
    <DsPage>
      <DsPageHeader
        slug="calendar"
        title="Calendar"
        description="React DayPicker styled with the app's button and interaction tokens, for single, multiple, and range date selection."
      />

      <DsSection
        id="single"
        title="Single selection"
        description={
          'mode="single" keeps one selected day; the selected cell uses the primary button treatment and today carries the selected tint.'
        }
      >
        <ComponentPreview code={singleCode} sourceCode={calendarSource}>
          <CalendarSingleDemo />
        </ComponentPreview>
      </DsSection>

      <DsSection
        id="range"
        title="Range selection"
        description={
          'mode="range" fills the days between the endpoints with the interactive-selected tint; captionLayout="dropdown" swaps the caption for month and year dropdowns.'
        }
      >
        <ComponentPreview code={rangeCode} sourceCode={calendarSource}>
          <CalendarRangeDemo />
        </ComponentPreview>
      </DsSection>

      <DsSection id="api" title="API Reference">
        <DsApiTable columnWidths={[22, 32, 12, 34]} rows={apiRows} />
        <DsParagraph className="mt-3">
          All remaining React DayPicker props (defaultMonth, startMonth,
          endMonth, showWeekNumber, locale, formatters, components, …) are
          forwarded; classNames and components merge over the wrapper&apos;s
          defaults.
        </DsParagraph>
      </DsSection>
    </DsPage>
  )
}
