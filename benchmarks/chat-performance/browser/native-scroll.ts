import { z } from "zod"

const traceEvent = z.object({
  name: z.string(),
  ph: z.string(),
  ts: z.number().finite().nonnegative(),
  pid: z.number().int().nonnegative(),
  id2: z.object({ local: z.string().optional() }).optional(),
  args: z.object({
    event_latency: z.object({ event_type: z.string() }).optional(),
  }).optional(),
})
const wheelAnchor = z.object({
  name: z.string().min(1),
  eventAt: z.number().finite().nonnegative(),
  observedAt: z.number().finite().nonnegative(),
})

/** Native presentation only: missing compositor evidence invalidates the sample. */
export function parseNativeScroll(trace: unknown, input: z.input<typeof wheelAnchor>) {
  const anchor = wheelAnchor.parse(input)
  if (anchor.observedAt < anchor.eventAt) throw new Error("Wheel anchor precedes input")
  const { traceEvents } = z.object({
    traceEvents: z.array(z.record(z.string(), z.unknown())),
  }).parse(trace)
  const events = traceEvents.filter((event) =>
    event.name === anchor.name || event.name === "EventLatency" ||
    event.name === "SwapEndToPresentationCompositorFrame"
  ).map((event) => traceEvent.parse(event))
  const marks = events.filter((event) => event.name === anchor.name && event.ph === "I")
  if (marks.length !== 1) throw new Error("Missing or ambiguous wheel anchor")
  // The mark uses startTime: observedAt; trace timestamps are microseconds.
  const generationTs = marks[0].ts - (anchor.observedAt - anchor.eventAt) * 1000
  // Allow 0.1ms timestamp rounding, but never multiple candidate gestures.
  const begins = events.filter((event) =>
    event.name === "EventLatency" && event.ph === "b" &&
    ["FIRST_GESTURE_SCROLL_UPDATE", "GESTURE_SCROLL_UPDATE"].includes(
      event.args?.event_latency?.event_type ?? ""
    ) && Math.abs(event.ts - generationTs) <= 100
  )
  if (begins.length !== 1) throw new Error("Missing or ambiguous native scroll update")
  const begin = begins[0]
  if (!begin.id2?.local) throw new Error("Native scroll update has no local async track")
  // Numeric event_latency_id can exceed MAX_SAFE_INTEGER. Local track IDs stay strings.
  const track = events.filter((event) =>
    event.pid === begin.pid && event.id2?.local === begin.id2?.local
  )
  if (track.filter((event) => event.name === "EventLatency" &&
    event.ph === "b" && event.ts === begin.ts).length !== 1)
    throw new Error("Ambiguous native scroll interval")
  const nextBegin = Math.min(Infinity, ...track.filter((event) =>
    event.name === "EventLatency" && event.ph === "b" && event.ts > begin.ts
  ).map((event) => event.ts))
  const ends = track.filter((event) =>
    event.name === "EventLatency" && event.ph === "e" &&
    event.ts > begin.ts && event.ts < nextBegin
  )
  if (ends.length !== 1) throw new Error("Incomplete or ambiguous native scroll interval")
  const presentations = track.filter((event) =>
    event.name === "SwapEndToPresentationCompositorFrame" &&
    event.ts >= begin.ts && event.ts <= ends[0].ts
  )
  const starts = presentations.filter((event) => event.ph === "b")
  const finishes = presentations.filter((event) => event.ph === "e")
  if (starts.length !== 1 || finishes.length !== 1 || finishes[0].ts < starts[0].ts)
    throw new Error("Missing or ambiguous compositor presentation")
  const inputToPresentationMs = (finishes[0].ts - begin.ts) / 1000
  if (!Number.isFinite(inputToPresentationMs) || inputToPresentationMs <= 0)
    throw new Error("Presentation must follow native input")
  return { inputToPresentationMs }
}
