import { describe, expect, it } from "vitest"
import { parseNativeScroll } from "./native-scroll"

const anchor = { name: "perf:wheel", eventAt: 1000, observedAt: 1400 }
const inputId = "7364717213562621727"
const event = (name: string, ph: string, ts: number, local = "0x1d") => ({
  name, ph, ts, pid: 3290, cat: "benchmark,input", id2: { local }, args: {},
})
const begin = (ts: number, type = "FIRST_GESTURE_SCROLL_UPDATE") => ({
  ...event("EventLatency", "b", ts),
  args: { event_latency: { event_type: type, event_latency_id: ts === 290223824 ? inputId : String(ts) } },
})
// Real Chrome nested async shape; presentation arrives after the last renderer stage.
const fixture = () => [
  event(anchor.name, "I", 290623824, "anchor"),
  begin(289000000), event("EventLatency", "e", 289500000),
  begin(290223824),
  { ...event("InputLatency::GestureScrollUpdate", "b", 290223824), args: {
    chrome_latency_info: { trace_id: inputId, component_info: [
      { component_type: "COMPONENT_INPUT_EVENT_LATENCY_ORIGINAL", time_us: 290223824 },
    ] },
  } },
  event("GenerationToBrowserMain", "b", 290223824),
  event("GenerationToBrowserMain", "e", 290585547),
  event("LatchToSwapEnd", "e", 291078167),
  event("SwapEndToPresentationCompositorFrame", "b", 291078167),
  event("SwapEndToPresentationCompositorFrame", "e", 291078272),
  event("EventLatency", "e", 291078272),
  { ...begin(291900000, "MOUSE_PRESSED"), id2: { local: "0x3" } },
  begin(292000000),
  event("GenerationToBrowserMain", "b", 292000000),
  event("GenerationToBrowserMain", "e", 292100000),
  event("SwapEndToPresentationCompositorFrame", "b", 292400000),
  event("SwapEndToPresentationCompositorFrame", "e", 292500000),
  event("EventLatency", "e", 292500000),
]

describe("native scroll presentation", () => {
  it("matches one gesture interval despite reused IDs and unrelated wheel/frame tracks", () => {
    const traceEvents = fixture()
    traceEvents.push(
      { ...begin(290223824, "MOUSE_WHEEL"), id2: { local: "0x21" } },
      event("GenerationToBrowserMain", "e", 290585548, "0x21"),
      event("SwapEndToPresentationCompositorFrame", "e", 291100000, "0x2"),
    )
    expect(parseNativeScroll({ traceEvents }, anchor)).toEqual({
      inputToPresentationMs: 854.448, automationDispatchMs: 361.723, browserToPresentationMs: 492.725,
    })
  })

  it.each([-200, -122, 153, 200])("matches a %iµs two-clamp residual without changing native duration", (residual) => {
    const traceEvents = fixture().map((e) => e.name === anchor.name ? { ...e, ts: e.ts - residual } : e)
    expect(parseNativeScroll({ traceEvents }, anchor)).toEqual({
      inputToPresentationMs: 854.448, automationDispatchMs: 361.723, browserToPresentationMs: 492.725,
    })
  })

  it.each([-201, 201])("rejects a %iµs residual outside the precision bound", (residual) => {
    const traceEvents = fixture().map((e) => e.name === anchor.name ? { ...e, ts: e.ts - residual } : e)
    expect(() => parseNativeScroll({ traceEvents }, anchor)).toThrow("Missing or ambiguous native scroll update")
  })

  it("rejects distinct gestures within the precision bound", () => {
    const traceEvents = [...fixture(), { ...begin(290223977), id2: { local: "0x2" } }]
    expect(() => parseNativeScroll({ traceEvents }, anchor)).toThrow("Missing or ambiguous native scroll update")
  })

  it.each([
    ["missing", (events: ReturnType<typeof fixture>) => events.filter((e) => e.id2.local !== "0x3")],
    ["early", (events: ReturnType<typeof fixture>) => events.map((e) => e.id2.local === "0x3" ? { ...e, ts: 291078271 } : e)],
    ["ambiguous", (events: ReturnType<typeof fixture>) => [...events, begin(291950000, "MOUSE_PRESSED")]],
  ])("rejects %s subsequent menu input", (_label, change) => {
    expect(() => parseNativeScroll({ traceEvents: change(fixture()) }, anchor)).toThrow(/menu input/i)
  })

  it("rejects zero browser duration through the duration guard", () => {
    const traceEvents = fixture().map((e) =>
      e.name === "GenerationToBrowserMain" && e.ph === "e" && e.ts === 290585547
        ? { ...e, ts: 291078272 } : e
    )
    expect(() => parseNativeScroll({ traceEvents }, anchor))
      .toThrow("Presentation must follow browser dispatch")
  })

  it.each([
    ["absent dispatch", (events: ReturnType<typeof fixture>) => events.filter((e) => e.name !== "GenerationToBrowserMain")],
    ["incomplete dispatch", (events: ReturnType<typeof fixture>) => events.filter((e) => !(e.name === "GenerationToBrowserMain" && e.ph === "e"))],
    ["duplicate dispatch", (events: ReturnType<typeof fixture>) => [...events, event("GenerationToBrowserMain", "e", 290585548)]],
    ["late dispatch start", (events: ReturnType<typeof fixture>) => events.map((e) => e.name === "GenerationToBrowserMain" && e.ph === "b" ? { ...e, ts: e.ts + 1 } : e)],
    ["absent presentation", (events: ReturnType<typeof fixture>) => events.filter((e) => !e.name.startsWith("SwapEnd"))],
    ["incomplete interval", (events: ReturnType<typeof fixture>) => events.filter((e) => !(e.name === "EventLatency" && e.ph === "e" && e.ts === 291078272))],
    ["duplicate gesture", (events: ReturnType<typeof fixture>) => [...events, begin(290223824)]],
    ["duplicate presentation", (events: ReturnType<typeof fixture>) => [...events, event("SwapEndToPresentationCompositorFrame", "e", 291078271)]],
    ["presentation before input", (events: ReturnType<typeof fixture>) => events.map((e) => e.name.startsWith("SwapEnd") ? { ...e, ts: 290000000 } : e)],
    ["wrong generation", (events: ReturnType<typeof fixture>) => events.map((e) => e.name === anchor.name ? { ...e, ts: e.ts + 1000 } : e)],
    ["wrong gesture type", (events: ReturnType<typeof fixture>) => events.map((e) => e.name === "EventLatency" && e.ph === "b" ? begin(e.ts, "MOUSE_WHEEL") : e)],
  ])("rejects %s without accepting a fallback stage", (_label, change) => {
    expect(() => parseNativeScroll({ traceEvents: change(fixture()) }, anchor)).toThrow()
  })
})

const surfaceId = "4388705654518307780"
const displayId = "4388705654518307778"
const forkedFixture = () => [
  ...fixture().filter((e) => !e.name.startsWith("SwapEnd") && e.name !== "InputLatency::GestureScrollUpdate").map((e) =>
    e.name === "EventLatency" && e.ph === "b" && e.ts === 290223824
      ? { ...e, args: { event_latency: { event_type: "FIRST_GESTURE_SCROLL_UPDATE", event_latency_id: inputId } } }
      : e
  ),
  { ...event("Graphics.Pipeline", "X", 290700000), args: {
    chrome_graphics_pipeline: { step: "STEP_SUBMIT_COMPOSITOR_FRAME", latency_ids: [inputId], surface_frame_trace_id: surfaceId },
  } },
  { ...event("InputLatency::GestureScrollUpdate", "b", 290223824), args: {
    chrome_latency_info: { trace_id: inputId, component_info: [
      { component_type: "COMPONENT_INPUT_EVENT_LATENCY_ORIGINAL", time_us: 290223824 },
      { component_type: "COMPONENT_INPUT_EVENT_LATENCY_FRAME_SWAP", time_us: 291078167 },
    ] },
  } },
  { ...event("Graphics.Pipeline", "X", 290800000), args: {
    chrome_graphics_pipeline: {
      step: "STEP_SURFACE_AGGREGATION", display_trace_id: displayId,
      aggregated_surface_frame_trace_ids: [surfaceId],
    },
  } },
  { ...event("PipelineReporter", "b", 290600000, "frame"), args: {
    frame_reporter: { state: "STATE_PRESENTED_ALL", surface_frame_trace_id: surfaceId, display_trace_id: displayId },
  } },
  event("SwapEndToPresentationCompositorFrame", "b", 291078167, "frame"),
  event("SwapEndToPresentationCompositorFrame", "e", 291078272, "frame"),
  event("PipelineReporter", "e", 291078272, "frame"),
  { ...event("PipelineReporter", "b", 290600000, "aborted"), args: {
    frame_reporter: { state: "STATE_NO_UPDATE_DESIRED", surface_frame_trace_id: surfaceId },
  } },
  event("PipelineReporter", "e", 291078272, "aborted"),
]

// Emit uint64 JSON tokens as Chromium does, without first rounding them in JS.
const rawTrace = (traceEvents: unknown) => JSON.stringify({ traceEvents })
  .replace(/"(-?\d{19})"/g, "$1")

describe("forked compositor presentation", () => {
  it("uses the exact submitted presented frame when the original event reporter aborts", () => {
    expect(parseNativeScroll(rawTrace(forkedFixture()), anchor)).toEqual({
      inputToPresentationMs: 854.448, automationDispatchMs: 361.723, browserToPresentationMs: 492.725,
    })
  })

  it("selects the input's early fork even when its original main reporter eventually presents", () => {
    const traceEvents = forkedFixture().map((e) =>
      e.name === "EventLatency" && e.ph === "e" && e.ts === 291078272 ? { ...e, ts: 291178272 } : e)
    traceEvents.push(
      event("SwapEndToPresentationCompositorFrame", "b", 291178167),
      event("SwapEndToPresentationCompositorFrame", "e", 291178272),
      { ...event("PipelineReporter", "b", 290600000, "slow-main"), args: {
        frame_reporter: { state: "STATE_PRESENTED_ALL", surface_frame_trace_id: surfaceId, display_trace_id: "4388705654518307779" },
      } },
      event("SwapEndToPresentationCompositorFrame", "b", 291178167, "slow-main"),
      event("SwapEndToPresentationCompositorFrame", "e", 291178272, "slow-main"),
      event("PipelineReporter", "e", 291178272, "slow-main"),
    )
    expect(parseNativeScroll(rawTrace(traceEvents), anchor).inputToPresentationMs).toBe(854.448)
  })

  it("keeps the direct presentation when the independent fork was dropped before submission", () => {
    const trace = rawTrace([...fixture(), {
      ...event("PipelineReporter", "b", 290600000, "dropped"),
      args: { frame_reporter: { state: "STATE_DROPPED", surface_frame_trace_id: surfaceId } },
    }])
    expect(parseNativeScroll(trace, anchor).inputToPresentationMs).toBe(854.448)
  })

  it("rejects missing or mismatched input identity despite complete direct presentation", () => {
    const trace = rawTrace(fixture())
    expect(() => parseNativeScroll(trace.replace(`,\"event_latency_id\":${inputId}`, ""), anchor))
      .toThrow("Native scroll update has no exact trace identifier")
    expect(() => parseNativeScroll(rawTrace(fixture().filter((e) => e.name !== "InputLatency::GestureScrollUpdate")), anchor))
      .toThrow("Missing or ambiguous native scroll latency record")
    expect(() => parseNativeScroll(trace.replace('"time_us":290223824', '"time_us":290223825'), anchor))
      .toThrow("Native scroll latency record does not match input")
  })

  it("rejects a missing submit even when a complete direct endpoint remains", () => {
    const traceEvents = forkedFixture().filter((e) => !(e.name === "Graphics.Pipeline" && e.ts === 290700000))
    traceEvents.push(
      event("SwapEndToPresentationCompositorFrame", "b", 291078167),
      event("SwapEndToPresentationCompositorFrame", "e", 291078272),
    )
    expect(() => parseNativeScroll(rawTrace(traceEvents), anchor)).toThrow("Missing or ambiguous native scroll frame submission")
  })

  it("rejects a different surface that collides on the same reporter interval", () => {
    const traceEvents = [...forkedFixture(), {
      ...event("PipelineReporter", "b", 290600000, "frame"),
      args: { frame_reporter: { state: "STATE_PRESENTED_ALL", surface_frame_trace_id: "4388705654518307781" } },
    }]
    expect(() => parseNativeScroll(rawTrace(traceEvents), anchor)).toThrow("Ambiguous presented frame interval")
  })

  it("rejects a forged swap timestamp and a display that aggregated another surface", () => {
    const trace = rawTrace(forkedFixture())
    expect(() => parseNativeScroll(trace.replace('"time_us":291078167', '"time_us":291078168'), anchor)).toThrow()
    expect(() => parseNativeScroll(trace.replace(`"aggregated_surface_frame_trace_ids":[${surfaceId}]`,
      '"aggregated_surface_frame_trace_ids":[4388705654518307781]'), anchor)).toThrow()
  })

  it("accepts signed Chromium event identifiers without rounding", () => {
    const trace = rawTrace(forkedFixture()).replaceAll(inputId, "-1844411730683114345")
    expect(parseNativeScroll(trace, anchor).inputToPresentationMs).toBe(854.448)
  })

  it("preserves adjacent uint64 identifiers that JavaScript numbers round together", () => {
    const traceEvents = forkedFixture()
    traceEvents.push({ ...event("Graphics.Pipeline", "X", 290700001), args: {
      chrome_graphics_pipeline: {
        step: "STEP_SUBMIT_COMPOSITOR_FRAME", latency_ids: ["7364717213562621728"], surface_frame_trace_id: surfaceId,
      },
    } })
    expect(parseNativeScroll(rawTrace(traceEvents), anchor).inputToPresentationMs).toBe(854.448)
    expect(() => parseNativeScroll(JSON.parse(rawTrace(traceEvents)), anchor)).toThrow()
  })

  it.each([
    ["missing submit", (events: ReturnType<typeof forkedFixture>) => events.filter((e) => e.name !== "Graphics.Pipeline")],
    ["ambiguous submit", (events: ReturnType<typeof forkedFixture>) => [...events, events.find((e) => e.name === "Graphics.Pipeline")]],
    ["missing input latency", (events: ReturnType<typeof forkedFixture>) => events.filter((e) => e.name !== "InputLatency::GestureScrollUpdate")],
    ["missing display aggregation", (events: ReturnType<typeof forkedFixture>) => events.filter((e) => !(e.name === "Graphics.Pipeline" && e.ts === 290800000))],
    ["missing surface join", (events: ReturnType<typeof forkedFixture>) => events.filter((e) => e.name !== "PipelineReporter")],
    ["unpresented state", (events: ReturnType<typeof forkedFixture>) => events.filter((e) => e.id2.local !== "frame")],
    ["ambiguous presented reporter", (events: ReturnType<typeof forkedFixture>) => [...events, events.find((e) => e.name === "PipelineReporter" && e.id2.local === "frame")]],
    ["missing presentation", (events: ReturnType<typeof forkedFixture>) => events.filter((e) => !e.name.startsWith("SwapEnd"))],
    ["incomplete presentation", (events: ReturnType<typeof forkedFixture>) => events.filter((e) => !(e.name.startsWith("SwapEnd") && e.ph === "e"))],
    ["reused frame interval", (events: ReturnType<typeof forkedFixture>) => [...events, event("PipelineReporter", "b", 290800000, "frame")]],
    ["menu before presentation", (events: ReturnType<typeof forkedFixture>) => events.map((e) => e.id2.local === "0x3" ? { ...e, ts: 291078271 } : e)],
  ])("rejects %s without substituting a renderer or unrelated frame endpoint", (_label, change) => {
    expect(() => parseNativeScroll(rawTrace(change(forkedFixture())), anchor)).toThrow()
  })

  it.each([fixture, forkedFixture])("rejects presentation stages from a different async category", (makeFixture) => {
    const traceEvents = makeFixture().map((e) => e.name.startsWith("SwapEnd")
      ? { ...e, cat: "cc,benchmark,other-track" } : e)
    expect(() => parseNativeScroll(rawTrace(traceEvents), anchor)).toThrow()
  })

  it("does not hide an incomplete direct presentation behind the frame join", () => {
    const traceEvents = [...forkedFixture(), event("SwapEndToPresentationCompositorFrame", "b", 291078167)]
    expect(() => parseNativeScroll(rawTrace(traceEvents), anchor)).toThrow("Missing or ambiguous compositor presentation")
  })
})
