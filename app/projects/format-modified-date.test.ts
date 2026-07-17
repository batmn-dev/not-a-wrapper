import { describe, expect, it } from "vitest"
import { formatModifiedDate } from "./format-modified-date"

// Fixed "now": Friday, July 17, 2026 (the reference capture date).
const now = new Date(2026, 6, 17, 12, 0, 0)

describe("formatModifiedDate", () => {
  it("uses the weekday name inside the current week", () => {
    expect(formatModifiedDate(new Date(2026, 6, 14).getTime(), now)).toBe(
      "Tuesday"
    )
    expect(formatModifiedDate(new Date(2026, 6, 17, 9).getTime(), now)).toBe(
      "Friday"
    )
  })

  it("uses month + day within the current year", () => {
    expect(formatModifiedDate(new Date(2026, 5, 23).getTime(), now)).toBe(
      "Jun 23"
    )
    // Exactly 7 days ago leaves the weekday window.
    expect(formatModifiedDate(new Date(2026, 6, 10).getTime(), now)).toBe(
      "Jul 10"
    )
  })

  it("appends the year outside the current year", () => {
    expect(formatModifiedDate(new Date(2025, 3, 22).getTime(), now)).toBe(
      "Apr 22, 2025"
    )
  })
})
