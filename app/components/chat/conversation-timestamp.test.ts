import { projectSelectedPath } from "@/lib/chat-store/turns/selected-path"
import type { ChatTurnMessage } from "@/lib/chat-turn/chat-turn-controller"
import { describe, expect, it } from "vitest"
import {
  deriveConversationTimestampHeaders,
  formatConversationDate,
  formatConversationTimestamp,
} from "./conversation-timestamp"

const HOUR = 60 * 60 * 1000
const TEN_MINUTES = 10 * 60 * 1000

function turn(role: string, createdAt?: unknown) {
  return { role, createdAt }
}

function normalizeSpacing(value: string): string {
  return value.replaceAll("\u202f", " ").replaceAll("\u00a0", " ")
}

describe("deriveConversationTimestampHeaders", () => {
  const now = new Date(2026, 6, 9, 12, 0)

  it("uses a strict one-hour threshold for the first user turn", () => {
    const [exactlyOneHour] = deriveConversationTimestampHeaders(
      [turn("user", new Date(now.getTime() - HOUR))],
      now
    )
    const [oneMillisecondBeyond] = deriveConversationTimestampHeaders(
      [turn("user", new Date(now.getTime() - HOUR - 1))],
      now
    )

    expect(exactlyOneHour).toBeUndefined()
    expect(oneMillisecondBeyond?.kind).toBe("full")
  })

  it("uses a strict one-hour assistant-to-user gap", () => {
    const exact = deriveConversationTimestampHeaders(
      [turn("assistant", new Date(now.getTime() - HOUR)), turn("user", now)],
      now
    )
    const beyond = deriveConversationTimestampHeaders(
      [
        turn("assistant", new Date(now.getTime() - HOUR - 1)),
        turn("user", now),
      ],
      now
    )

    expect(exact[1]).toBeUndefined()
    expect(beyond[1]?.kind).toBe("full")
  })

  it("uses a strict ten-minute assistant-to-assistant gap", () => {
    const exact = deriveConversationTimestampHeaders(
      [
        turn("assistant", new Date(now.getTime() - TEN_MINUTES)),
        turn("assistant", now),
      ],
      now
    )
    const beyond = deriveConversationTimestampHeaders(
      [
        turn("assistant", new Date(now.getTime() - TEN_MINUTES - 1)),
        turn("assistant", now),
      ],
      now
    )

    expect(exact[1]).toBeUndefined()
    expect(beyond[1]?.kind).toBe("full")
  })

  it("does not start new full groups for consecutive user turns", () => {
    const headers = deriveConversationTimestampHeaders(
      [
        turn("user", new Date(now.getTime() - 3 * HOUR)),
        turn("user", new Date(now.getTime() - HOUR)),
        turn("user", now),
      ],
      now
    )

    expect(headers.map((header) => header?.kind)).toEqual([
      "full",
      undefined,
      undefined,
    ])
  })

  it("tolerates missing, invalid, and non-Date values without inventing headers", () => {
    const headers = deriveConversationTimestampHeaders(
      [
        turn("user"),
        turn("assistant", new Date(Number.NaN)),
        turn("user", "2026-07-09T12:00:00"),
      ],
      now
    )

    expect(headers).toEqual([undefined, undefined, undefined])
  })

  it("uses the last valid rendered date for a calendar-day fallback", () => {
    const headers = deriveConversationTimestampHeaders(
      [
        turn("user", new Date(2026, 6, 8, 23, 59)),
        turn("system"),
        turn("user", new Date(2026, 6, 9, 0, 1)),
      ],
      new Date(2026, 6, 9, 0, 10)
    )

    expect(headers[2]?.kind).toBe("date")
  })

  it("lets a full timestamp win over a date-only boundary", () => {
    const current = new Date(2026, 6, 9, 0, 1)
    const headers = deriveConversationTimestampHeaders(
      [turn("assistant", new Date(2026, 6, 8, 22, 0)), turn("user", current)],
      new Date(2026, 6, 9, 0, 10)
    )

    expect(headers[1]?.kind).toBe("full")
  })

  it("detects local midnight and year boundaries in an explicit timezone", () => {
    const timeZone = "America/New_York"
    const midnight = deriveConversationTimestampHeaders(
      [
        turn("user", new Date("2026-07-09T03:59:00.000Z")),
        turn("user", new Date("2026-07-09T04:01:00.000Z")),
      ],
      new Date("2026-07-09T04:02:00.000Z"),
      timeZone
    )
    const newYear = deriveConversationTimestampHeaders(
      [
        turn("user", new Date("2027-01-01T04:59:00.000Z")),
        turn("user", new Date("2027-01-01T05:01:00.000Z")),
      ],
      new Date("2027-01-01T05:02:00.000Z"),
      timeZone
    )

    expect(midnight.map((header) => header?.kind)).toEqual([undefined, "date"])
    expect(newYear.map((header) => header?.kind)).toEqual([undefined, "date"])
  })

  it("uses elapsed time, not wall-clock jumps, across DST transitions", () => {
    const springForward = deriveConversationTimestampHeaders(
      [
        turn("assistant", new Date("2026-03-08T01:55:00-05:00")),
        turn("assistant", new Date("2026-03-08T03:05:00-04:00")),
      ],
      new Date("2026-03-08T03:06:00-04:00"),
      "America/New_York"
    )
    const fallBack = deriveConversationTimestampHeaders(
      [
        turn("assistant", new Date("2026-11-01T01:55:00-04:00")),
        turn("assistant", new Date("2026-11-01T01:05:00-05:00")),
      ],
      new Date("2026-11-01T01:06:00-05:00"),
      "America/New_York"
    )

    expect(springForward[1]).toBeUndefined()
    expect(fallBack[1]).toBeUndefined()
  })

  it("adds a date boundary even when the elapsed duration is only two minutes", () => {
    const headers = deriveConversationTimestampHeaders(
      [
        turn("user", new Date("2026-07-09T03:59:00.000Z")),
        turn("user", new Date("2026-07-09T04:01:00.000Z")),
      ],
      new Date("2026-07-09T04:02:00.000Z"),
      "America/New_York"
    )

    expect(headers[1]?.kind).toBe("date")
  })
})

describe("conversation timestamp formatting", () => {
  const now = new Date(2026, 6, 9, 12, 0)

  it("formats Today, Yesterday, weekday, same-year, and prior-year labels", () => {
    expect(
      formatConversationTimestamp(new Date(2026, 6, 9, 9, 3), now, "en-US")
        .primaryText
    ).toBe("Today")
    expect(
      formatConversationTimestamp(new Date(2026, 6, 8, 16, 12), now, "en-US")
        .primaryText
    ).toBe("Yesterday")
    expect(
      formatConversationTimestamp(new Date(2026, 6, 7, 16, 12), now, "en-US")
        .primaryText
    ).toBe("Tuesday")
    expect(
      formatConversationTimestamp(new Date(2026, 0, 1, 16, 12), now, "en-US")
        .primaryText
    ).toBe("Thu, Jan 1")
    expect(
      formatConversationTimestamp(new Date(2025, 6, 7, 16, 12), now, "en-US")
        .primaryText
    ).toBe("Jul 7, 2025")
  })

  it("formats the same instant in representative 12-hour and 24-hour locales", () => {
    const instant = new Date("2026-07-09T20:12:00.000Z")
    const referenceNow = new Date("2026-07-09T22:00:00.000Z")
    const us = formatConversationTimestamp(
      instant,
      referenceNow,
      "en-US",
      "America/New_York"
    )
    const gb = formatConversationTimestamp(
      instant,
      referenceNow,
      "en-GB",
      "America/New_York"
    )

    expect(normalizeSpacing(us.secondaryText)).toBe("4:12 PM")
    expect(gb.secondaryText).toBe("16:12")
  })

  it("localizes the old-date time connector", () => {
    const date = new Date(2026, 0, 1, 16, 12)
    const english = formatConversationTimestamp(date, now, "en-US")
    const german = formatConversationTimestamp(date, now, "de-DE")

    expect(normalizeSpacing(english.secondaryText)).toBe("at 4:12 PM")
    expect(german.secondaryText).toBe("um 16:12")
  })

  it("formats date-only fallbacks by relative day and calendar year", () => {
    expect(formatConversationDate(now, now, "en-US")).toBe("Today")
    expect(formatConversationDate(new Date(2026, 6, 8), now, "en-US")).toBe(
      "Yesterday"
    )
    expect(formatConversationDate(new Date(2026, 0, 1), now, "en-US")).toBe(
      "Jan 1"
    )
    expect(formatConversationDate(new Date(2025, 11, 31), now, "en-US")).toBe(
      "Dec 31, 2025"
    )
  })
})

describe("canonical timestamp reconciliation thresholds", () => {
  const start = new Date("2026-07-09T12:00:00.000Z")

  function message(
    id: string,
    role: "user" | "assistant",
    createdAt: Date,
    metadata?: Record<string, unknown>
  ): ChatTurnMessage {
    return {
      id,
      role,
      createdAt,
      metadata,
      parts: [{ type: "text", text: id }],
    }
  }

  it("keeps assistant-to-user and assistant-to-assistant decisions strict after canonical adoption", () => {
    const assistantToUser = projectSelectedPath(
      [
        message("a1", "assistant", start),
        message("u1", "user", new Date(start.getTime() + HOUR + 2)),
      ],
      [
        message("a1", "assistant", start, { serverMessageId: "a1" }),
        message("u1", "user", new Date(start.getTime() + HOUR + 1), {
          serverMessageId: "server-u1",
        }),
      ]
    )
    const assistantToAssistant = projectSelectedPath(
      [
        message("a1", "assistant", start),
        message("a2", "assistant", new Date(start.getTime() + TEN_MINUTES + 2)),
      ],
      [
        message("a1", "assistant", start, { serverMessageId: "a1" }),
        message(
          "a2",
          "assistant",
          new Date(start.getTime() + TEN_MINUTES + 1),
          {
            serverMessageId: "a2",
          }
        ),
      ]
    )

    expect(
      deriveConversationTimestampHeaders(
        assistantToUser,
        assistantToUser[1].createdAt!
      )[1]?.kind
    ).toBe("full")
    expect(
      deriveConversationTimestampHeaders(
        assistantToAssistant,
        assistantToAssistant[1].createdAt!
      )[1]?.kind
    ).toBe("full")
  })

  it("does not add tolerance when the canonical timestamp lands on an exact threshold", () => {
    const live = [
      message("a1", "assistant", start),
      message("u1", "user", new Date(start.getTime() + HOUR + 1)),
    ]
    const canonical = [
      message("a1", "assistant", start, { serverMessageId: "a1" }),
      message("u1", "user", new Date(start.getTime() + HOUR), {
        serverMessageId: "server-u1",
      }),
    ]
    const reconciled = projectSelectedPath(live, canonical)

    expect(reconciled.map((entry) => entry.id)).toEqual(["a1", "u1"])
    expect(reconciled[1].createdAt).toEqual(canonical[1].createdAt)
    expect(
      deriveConversationTimestampHeaders(
        reconciled,
        reconciled[1].createdAt!
      )[1]
    ).toBeUndefined()
  })

  it("re-derives from a selected sibling's different canonical timestamp", () => {
    const live = [
      message("selected-old", "user", new Date(start.getTime() - HOUR - 1), {
        serverMessageId: "server-old",
      }),
    ]
    const sibling = [
      message("selected-new", "user", start, {
        serverMessageId: "server-new",
      }),
    ]
    const reconciled = projectSelectedPath(live, sibling)

    expect(reconciled).toBe(sibling)
    expect(
      deriveConversationTimestampHeaders(reconciled, start)[0]
    ).toBeUndefined()
  })
})
