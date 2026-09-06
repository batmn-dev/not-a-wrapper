import { z } from "zod"

const traceId = z.union([
  z.string().regex(/^-?\d+$/),
  z.number().int().refine(Number.isSafeInteger),
]).transform(String)

const traceEvent = z.object({
  name: z.string(),
  cat: z.string().optional(),
  ph: z.string(),
  ts: z.number().finite().nonnegative(),
  pid: z.number().int().nonnegative(),
  id2: z.object({ local: z.string().optional() }).optional(),
  args: z.object({
    event_latency: z.object({
      event_type: z.string(), event_latency_id: traceId.optional(),
    }).optional(),
    chrome_graphics_pipeline: z.object({
      step: z.string(), latency_ids: z.array(traceId).optional(),
      surface_frame_trace_id: traceId.optional(),
    }).optional(),
    frame_reporter: z.object({
      state: z.string(), surface_frame_trace_id: traceId.optional(),
    }).optional(),
  }).optional(),
})
const wheelAnchor = z.object({
  name: z.string().min(1),
  eventAt: z.number().finite().nonnegative(),
  observedAt: z.number().finite().nonnegative(),
})

// Bun exposes the original numeric token so 64-bit trace IDs never round together.
function readTrace(trace: unknown): unknown {
  if (typeof trace !== "string") return trace
  return JSON.parse(trace, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value !== "number" || !Number.isInteger(value) || Number.isSafeInteger(value))
      return value
    if (!context?.source || !/^-?\d+$/.test(context.source))
      throw new Error("Trace contains an unsafe numeric identifier")
    return context.source
  })
}

type TraceEvent = z.infer<typeof traceEvent>

function presentedFrame(events: TraceEvent[], begin: TraceEvent, end: number): number {
  const inputId = begin.args?.event_latency?.event_latency_id
  if (!inputId) throw new Error("Native scroll update has no exact trace identifier")
  const submits = events.filter((event) =>
    event.name === "Graphics.Pipeline" && event.ph === "X" && event.pid === begin.pid &&
    event.ts >= begin.ts && event.ts <= end &&
    event.args?.chrome_graphics_pipeline?.step === "STEP_SUBMIT_COMPOSITOR_FRAME" &&
    event.args.chrome_graphics_pipeline.latency_ids?.includes(inputId)
  )
  if (submits.length !== 1) throw new Error("Missing or ambiguous native scroll frame submission")
  const submit = submits[0]
  const surface = submit.args?.chrome_graphics_pipeline?.surface_frame_trace_id
  if (!surface) throw new Error("Native scroll submission has no surface frame identifier")
  const reporters = events.filter((event) =>
    event.name === "PipelineReporter" && event.ph === "b" && event.pid === begin.pid &&
    event.ts <= submit.ts && event.args?.frame_reporter?.surface_frame_trace_id === surface &&
    ["STATE_PRESENTED_ALL", "STATE_PRESENTED_PARTIAL"].includes(event.args.frame_reporter.state)
  )
  if (reporters.length !== 1) throw new Error("Missing or ambiguous presented native scroll frame")
  const reporter = reporters[0]
  if (!reporter.id2?.local) throw new Error("Presented frame has no local async track")
  const track = events.filter((event) =>
    event.pid === reporter.pid && event.cat === reporter.cat &&
    event.id2?.local === reporter.id2?.local && event.ts >= reporter.ts
  )
  const nextBegin = Math.min(Infinity, ...track.filter((event) =>
    event.name === "PipelineReporter" && event.ph === "b" && event.ts > reporter.ts
  ).map((event) => event.ts))
  const ends = track.filter((event) =>
    event.name === "PipelineReporter" && event.ph === "e" &&
    event.ts >= submit.ts && event.ts < nextBegin
  )
  if (ends.length !== 1) throw new Error("Incomplete or ambiguous presented frame interval")
  const presentation = track.filter((event) =>
    event.name === "SwapEndToPresentationCompositorFrame" &&
    event.ts >= submit.ts && event.ts <= ends[0].ts
  )
  const starts = presentation.filter((event) => event.ph === "b")
  const finishes = presentation.filter((event) => event.ph === "e")
  if (starts.length !== 1 || finishes.length !== 1 || finishes[0].ts < starts[0].ts)
    throw new Error("Missing or ambiguous compositor presentation")
  return finishes[0].ts
}

/** Native presentation only: missing compositor evidence invalidates the sample. */
export function parseNativeScroll(trace: unknown, input: z.input<typeof wheelAnchor>) {
  const anchor = wheelAnchor.parse(input)
  if (anchor.observedAt < anchor.eventAt) throw new Error("Wheel anchor precedes input")
  const { traceEvents } = z.object({
    traceEvents: z.array(z.record(z.string(), z.unknown())),
  }).parse(readTrace(trace))
  const events = traceEvents.filter((event) =>
    event.name === anchor.name || event.name === "EventLatency" ||
    event.name === "SwapEndToPresentationCompositorFrame" || event.name === "GenerationToBrowserMain" ||
    event.name === "Graphics.Pipeline" || event.name === "PipelineReporter"
  ).map((event) => traceEvent.parse(event))
  const marks = events.filter((event) => event.name === anchor.name && event.ph === "I")
  if (marks.length !== 1) throw new Error("Missing or ambiguous wheel anchor")
  // The mark uses startTime: observedAt; trace timestamps are microseconds.
  const generationTs = marks[0].ts - (anchor.observedAt - anchor.eventAt) * 1000
  // Chromium independently clamps event time and time origin by up to 100µs each.
  const begins = events.filter((event) =>
    event.name === "EventLatency" && event.ph === "b" &&
    ["FIRST_GESTURE_SCROLL_UPDATE", "GESTURE_SCROLL_UPDATE"].includes(
      event.args?.event_latency?.event_type ?? ""
    ) && Math.abs(event.ts - generationTs) <= 200
  )
  if (begins.length !== 1) throw new Error("Missing or ambiguous native scroll update")
  const begin = begins[0]
  if (!begin.id2?.local) throw new Error("Native scroll update has no local async track")
  // Numeric event_latency_id can exceed MAX_SAFE_INTEGER. Local track IDs stay strings.
  const track = events.filter((event) =>
    event.pid === begin.pid && event.cat === begin.cat && event.id2?.local === begin.id2?.local
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
  if (presentations.length > 0 &&
    (starts.length !== 1 || finishes.length !== 1 || finishes[0].ts < starts[0].ts))
    throw new Error("Missing or ambiguous compositor presentation")
  // Chromium can retain EventLatency on an aborted main reporter after the
  // exact input's forked compositor frame has already presented.
  const presentationAt = presentations.length === 0
    ? presentedFrame(events, begin, ends[0].ts)
    : finishes[0].ts
  const dispatch = track.filter((event) =>
    event.name === "GenerationToBrowserMain" && event.ts >= begin.ts && event.ts <= ends[0].ts
  )
  const dispatchStarts = dispatch.filter((event) => event.ph === "b")
  const dispatchEnds = dispatch.filter((event) => event.ph === "e")
  if (dispatchStarts.length !== 1 || dispatchEnds.length !== 1 ||
    dispatchStarts[0].ts !== begin.ts || dispatchEnds[0].ts <= dispatchStarts[0].ts)
    throw new Error("Missing, incomplete, or ambiguous browser dispatch interval")
  const menuInputs = events.filter((event) =>
    event.name === "EventLatency" && event.ph === "b" && event.ts > begin.ts &&
    event.args?.event_latency?.event_type === "MOUSE_PRESSED"
  )
  if (menuInputs.length !== 1) throw new Error("Missing or ambiguous subsequent menu input")
  if (menuInputs[0].ts < presentationAt)
    throw new Error("Menu input preceded wheel presentation")
  const inputToPresentationMs = (presentationAt - begin.ts) / 1000
  if (!Number.isFinite(inputToPresentationMs) || inputToPresentationMs <= 0)
    throw new Error("Presentation must follow native input")
  // CDP timestamps before its visual-state barrier, so this includes automation work:
  // https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.34/content/browser/devtools/protocol/input_handler.cc#1425
  const automationDispatchMs = (dispatchEnds[0].ts - begin.ts) / 1000
  const browserToPresentationMs = (presentationAt - dispatchEnds[0].ts) / 1000
  if (!Number.isFinite(browserToPresentationMs) || browserToPresentationMs <= 0)
    throw new Error("Presentation must follow browser dispatch")
  return { inputToPresentationMs, automationDispatchMs, browserToPresentationMs }
}
