const DAY_MS = 86_400_000

/**
 * Compact "Modified" date in the reference directory style: a weekday name
 * inside the current week ("Tuesday"), month + day within the current year
 * ("Jun 23"), and month + day + year beyond it ("Apr 22, 2025").
 * The input is the project's persisted modification timestamp. Callers may
 * fall back to `_creationTime` only for legacy rows awaiting backfill.
 */
export function formatModifiedDate(
  timestampMs: number,
  now: Date = new Date()
): string {
  const date = new Date(timestampMs)
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS)

  if (dayDiff >= 0 && dayDiff < 7) {
    return date.toLocaleDateString("en-US", { weekday: "long" })
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}
