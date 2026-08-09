"use client"

import { Calendar } from "@/components/ui/calendar"
import { useState } from "react"

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
