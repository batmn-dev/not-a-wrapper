const ONE_HOUR_MS = 60 * 60 * 1000
const TEN_MINUTES_MS = 10 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

type TimestampTurn = {
  role: string
  createdAt?: unknown
}

export type ConversationTimestampHeader = {
  kind: "full" | "date"
  date: Date
}

export type ConversationTimestampText = {
  label: string
  primaryText: string
  secondaryText: string
}

function validDate(value: unknown): Date | undefined {
  if (!(value instanceof Date)) return undefined
  return Number.isFinite(value.getTime()) ? value : undefined
}

function localDayNumber(date: Date, timeZone?: string): number {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(date)
    const year = Number(parts.find((part) => part.type === "year")?.value)
    const month = Number(parts.find((part) => part.type === "month")?.value)
    const day = Number(parts.find((part) => part.type === "day")?.value)
    return Date.UTC(year, month - 1, day) / ONE_DAY_MS
  }

  return (
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / ONE_DAY_MS
  )
}

function isSameLocalDay(first: Date, second: Date, timeZone?: string): boolean {
  return localDayNumber(first, timeZone) === localDayNumber(second, timeZone)
}

function daysAgo(date: Date, now: Date, timeZone?: string): number {
  return localDayNumber(now, timeZone) - localDayNumber(date, timeZone)
}

function capitalizeRelativeLabel(
  value: string,
  formatter: Intl.RelativeTimeFormat
): string {
  const [first, ...rest] = Array.from(value)
  if (!first) return value
  return `${first.toLocaleUpperCase(formatter.resolvedOptions().locale)}${rest.join("")}`
}

function formatRelativeDay(
  dayOffset: 0 | 1,
  locales?: Intl.LocalesArgument
): string {
  const formatter = new Intl.RelativeTimeFormat(locales, { numeric: "auto" })
  return capitalizeRelativeLabel(formatter.format(-dayOffset, "day"), formatter)
}

function formatTime(
  date: Date,
  locales?: Intl.LocalesArgument,
  timeZone?: string
): string {
  return new Intl.DateTimeFormat(locales, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date)
}

function formatTimeWithLocalizedConnector(
  date: Date,
  locales?: Intl.LocalesArgument,
  timeZone?: string
): string {
  const time = formatTime(date, locales, timeZone)
  const parts = new Intl.DateTimeFormat(locales, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).formatToParts(date)
  const hourIndex = parts.findIndex((part) => part.type === "hour")
  const precedingPart = hourIndex > 0 ? parts[hourIndex - 1] : undefined
  const connector =
    precedingPart?.type === "literal" ? precedingPart.value.trim() : ""

  return connector ? `${connector} ${time}` : time
}

/**
 * Derive headers from the already-selected rendered path in one pass. Missing
 * dates remain part of the role sequence but never manufacture a timestamp;
 * date-only boundaries continue from the last valid rendered date.
 */
export function deriveConversationTimestampHeaders(
  turns: readonly TimestampTurn[],
  now: Date,
  timeZone?: string
): Array<ConversationTimestampHeader | undefined> {
  const headers: Array<ConversationTimestampHeader | undefined> = []
  let hasRenderedUser = false
  let previousTurn: { role: string; date?: Date } | undefined
  let lastValidDate: Date | undefined

  for (const turn of turns) {
    const date = validDate(turn.createdAt)
    const isFirstRenderedUser = turn.role === "user" && !hasRenderedUser
    let kind: ConversationTimestampHeader["kind"] | undefined

    if (date) {
      const dateMs = date.getTime()
      const previousDate = previousTurn?.date
      const gapFromPrevious = previousDate
        ? dateMs - previousDate.getTime()
        : undefined

      if (
        (isFirstRenderedUser && now.getTime() - dateMs > ONE_HOUR_MS) ||
        (previousTurn?.role === "assistant" &&
          turn.role === "user" &&
          gapFromPrevious !== undefined &&
          gapFromPrevious > ONE_HOUR_MS) ||
        (previousTurn?.role === "assistant" &&
          turn.role === "assistant" &&
          gapFromPrevious !== undefined &&
          gapFromPrevious > TEN_MINUTES_MS)
      ) {
        kind = "full"
      } else if (
        lastValidDate &&
        !isSameLocalDay(lastValidDate, date, timeZone)
      ) {
        kind = "date"
      }
    }

    headers.push(kind && date ? { kind, date } : undefined)

    if (turn.role === "user") hasRenderedUser = true
    previousTurn = { role: turn.role, date }
    if (date) lastValidDate = date
  }

  return headers
}

export function formatConversationTimestamp(
  date: Date,
  now: Date,
  locales?: Intl.LocalesArgument,
  timeZone?: string
): ConversationTimestampText {
  const dayOffset = daysAgo(date, now, timeZone)
  const secondaryText =
    dayOffset > 7
      ? formatTimeWithLocalizedConnector(date, locales, timeZone)
      : formatTime(date, locales, timeZone)
  let primaryText: string

  if (dayOffset === 0) {
    primaryText = formatRelativeDay(0, locales)
  } else if (dayOffset === 1) {
    primaryText = formatRelativeDay(1, locales)
  } else if (dayOffset >= 2 && dayOffset <= 7) {
    primaryText = new Intl.DateTimeFormat(locales, {
      weekday: "long",
      timeZone,
    }).format(date)
  } else if (dayOffset > 7 && dayOffset <= 365) {
    primaryText = new Intl.DateTimeFormat(locales, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone,
    }).format(date)
  } else {
    primaryText = new Intl.DateTimeFormat(locales, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone,
    }).format(date)
  }

  return {
    label: `${primaryText} ${secondaryText}`,
    primaryText,
    secondaryText,
  }
}

export function formatConversationDate(
  date: Date,
  now: Date,
  locales?: Intl.LocalesArgument,
  timeZone?: string
): string {
  const dayOffset = daysAgo(date, now, timeZone)

  if (dayOffset === 0) return formatRelativeDay(0, locales)
  if (dayOffset === 1) return formatRelativeDay(1, locales)

  return new Intl.DateTimeFormat(locales, {
    month: "short",
    day: "numeric",
    timeZone,
    ...(date.getFullYear() === now.getFullYear()
      ? {}
      : { year: "numeric" as const }),
  }).format(date)
}

export function ConversationTimestamp({
  header,
  now,
}: {
  header: ConversationTimestampHeader
  now: Date
}) {
  if (header.kind === "date") {
    const label = formatConversationDate(header.date, now)

    return (
      <div className="my-4 flex h-5 justify-center">
        <span className="text-muted-foreground text-sm leading-5 font-normal">
          <span className="text-[var(--text-tertiary)]">
            <span className="font-medium">{label}</span>
          </span>
        </span>
      </div>
    )
  }

  const { label, primaryText, secondaryText } = formatConversationTimestamp(
    header.date,
    now
  )

  return (
    <div
      aria-label={label}
      className="my-4 flex h-5 justify-center"
      role="separator"
    >
      <span className="text-muted-foreground text-sm leading-5 font-normal">
        <span className="text-[var(--text-tertiary)]">
          <span className="font-medium">{primaryText}</span>{" "}
          <span className="font-normal">{secondaryText}</span>
        </span>
      </span>
    </div>
  )
}
