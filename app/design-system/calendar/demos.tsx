"use client"

import { Calendar } from "@/components/ui/calendar"
import { useState } from "react"
import type { DateRange } from "react-day-picker"

export function CalendarSingleDemo() {
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 7, 12))

  return (
    <Calendar
      mode="single"
      selected={date}
      onSelect={setDate}
      defaultMonth={date}
      className="rounded-xl border"
    />
  )
}

export function CalendarRangeDemo() {
  const [range, setRange] = useState<DateRange | undefined>({
    from: new Date(2026, 7, 10),
    to: new Date(2026, 7, 16),
  })

  return (
    <Calendar
      mode="range"
      selected={range}
      onSelect={setRange}
      defaultMonth={range?.from}
      captionLayout="dropdown"
      className="rounded-xl border"
    />
  )
}
