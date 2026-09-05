import { describe, expect, it } from "vitest"
import { parseNativeScroll } from "./native-scroll"

const anchor = { name: "perf:wheel", eventAt: 1000, observedAt: 1400 }
const event = (name: string, ph: string, ts: number, local = "0x1d") => ({
  name, ph, ts, pid: 3290, id2: { local }, args: {},
})
const begin = (ts: number, type = "FIRST_GESTURE_SCROLL_UPDATE") => ({
  ...event("EventLatency", "b", ts),
  args: { event_latency: { event_type: type } },
})
// Real Chrome nested async shape; presentation arrives after the last renderer stage.
const fixture = () => [
  event(anchor.name, "I", 290623824, "anchor"),
  begin(289000000), event("EventLatency", "e", 289500000),
  begin(290223824),
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
