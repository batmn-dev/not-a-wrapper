import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CHAT_PERF_ID_HEADER,
  createChatPerfCorrelationId,
  createChatPerfServerSession,
  DETACHED_BINDING_GAUGE_EVENTS,
  getChatPerfServerSampleRate,
  isChatPerfClientEnabled,
  markChatPerf,
  parseChatPerfIdHeader,
  validateChatPerfEvent,
} from "./chat-performance"
import {
  beginChatPerfTurn,
  clearArmedChatPerfHeader,
  takeChatPerfHeader,
} from "./chat-performance-client"

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION
  delete process.env.CHAT_PERF_SAMPLE_RATE
  vi.restoreAllMocks()
})

describe("enablement and sampling", () => {
  it("is off by default on both sides", () => {
    expect(isChatPerfClientEnabled()).toBe(false)
    expect(getChatPerfServerSampleRate()).toBe(0)
  })

  it("clamps and rejects malformed sample rates", () => {
    process.env.CHAT_PERF_SAMPLE_RATE = "0.25"
    expect(getChatPerfServerSampleRate()).toBe(0.25)
    process.env.CHAT_PERF_SAMPLE_RATE = "7"
    expect(getChatPerfServerSampleRate()).toBe(1)
    process.env.CHAT_PERF_SAMPLE_RATE = "not-a-number"
    expect(getChatPerfServerSampleRate()).toBe(0)
  })
})

describe("correlation id", () => {
  it("accepts only UUID-shaped values and drops the rest silently", () => {
    const id = createChatPerfCorrelationId()
    expect(parseChatPerfIdHeader(id)).toBe(id)
    expect(parseChatPerfIdHeader(id.toUpperCase())).toBe(id)
    for (const invalid of [
      null,
      undefined,
      "",
      "not-a-uuid",
      "sk-ant-api03-abcdefgh12345678",
      `${id}${id}`,
      "a".repeat(100),
    ]) {
      expect(parseChatPerfIdHeader(invalid)).toBeUndefined()
    }
  })

  it("disarms only the matching undispatched turn header", () => {
    process.env.NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION = "true"
    const rejectedTurnId = beginChatPerfTurn()
    const newerTurnId = beginChatPerfTurn()

    clearArmedChatPerfHeader(rejectedTurnId)
    expect(takeChatPerfHeader()).toEqual({
      [CHAT_PERF_ID_HEADER]: newerTurnId,
    })

    const undispatchedTurnId = beginChatPerfTurn()
    clearArmedChatPerfHeader(undispatchedTurnId)
    expect(takeChatPerfHeader()).toEqual({})
  })
})

describe("event schema allow-list", () => {
  it("rejects unknown events and unknown fields — string fields included", () => {
    expect(validateChatPerfEvent("made_up_event", {}).ok).toBe(false)
    expect(
      validateChatPerfEvent("chat_send_intent", { prompt: "hi there" }).ok
    ).toBe(false)
    expect(
      validateChatPerfEvent("server_span", {
        span: "durable_prepare",
        durationMs: 12,
        ok: true,
        chatId: "chat_123",
      }).ok
    ).toBe(false)
  })

  it("rejects enum violations, bad numbers, and non-correlation strings", () => {
    expect(
      validateChatPerfEvent("stream_terminal", { outcome: "meltdown" }).ok
    ).toBe(false)
    expect(
      validateChatPerfEvent("server_span", {
        span: "durable_prepare",
        durationMs: Number.NaN,
        ok: true,
      }).ok
    ).toBe(false)
    expect(
      validateChatPerfEvent("chat_send_intent", {
        correlationId: "free-form text",
      }).ok
    ).toBe(false)
  })

  it.each([
    "composer.keystroke_to_next_paint",
    "composer.keystroke_to_settled_paint",
  ])("requires durationMs for %s", (event) => {
    expect(validateChatPerfEvent(event, {})).toEqual({
      ok: false,
      reason: "missing required field: durationMs",
    })
  })

  it("rejects any field carrying a credential-shaped value", () => {
    expect(
      validateChatPerfEvent("stream_terminal", {
        outcome: "sk-proj-abcdefgh12345678" as never,
      }).ok
    ).toBe(false)
  })

  it("accepts the documented shapes", () => {
    const correlationId = createChatPerfCorrelationId()
    expect(
      validateChatPerfEvent("server_span", {
        span: "usage_admission",
        durationMs: 4.2,
        ok: true,
        correlationId,
      })
    ).toEqual({ ok: true })
    expect(
      validateChatPerfEvent("checkpoint", { kind: "attempt", payloadBytes: 91 })
    ).toEqual({ ok: true })
    for (const event of DETACHED_BINDING_GAUGE_EVENTS) {
      expect(
        validateChatPerfEvent("detached_binding_gauge", {
          event,
          attachedCount: 1,
          detachedCount: event === "detached" ? 1 : 0,
          bindingClass: "durable",
        })
      ).toEqual({ ok: true })
    }
  })
})

describe("client marks", () => {
  it("emits zero calls when instrumentation is disabled", () => {
    const spy = vi.spyOn(performance, "mark")
    markChatPerf("chat_send_intent")
    expect(spy).not.toHaveBeenCalled()
  })

  it("emits a prefixed User Timing mark when enabled, dropping invalid events", () => {
    process.env.NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION = "true"
    const spy = vi.spyOn(performance, "mark")
    markChatPerf("navigation_cache_hit_or_miss", { cache: "hit" })
    expect(spy).toHaveBeenCalledWith("chat-perf:navigation_cache_hit_or_miss", {
      detail: { cache: "hit" },
    })
    spy.mockClear()
    markChatPerf("navigation_cache_hit_or_miss", { cache: "sideways" })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe("server session", () => {
  it("returns the no-op session when unsampled and never logs", async () => {
    const log = vi.spyOn(console, "log")
    const session = createChatPerfServerSession(null)
    expect(session.sampled).toBe(false)
    const result = await session.span("durable_prepare", async () => 42)
    session.counter("attempt", 10)
    session.record("stream_start", 5)
    expect(result).toBe(42)
    expect(log).not.toHaveBeenCalled()
  })

  it("carries a valid correlation id through spans and counters when sampled", async () => {
    const correlationId = createChatPerfCorrelationId()
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const session = createChatPerfServerSession(correlationId, {
      rate: 1,
      random: () => 0,
    })
    expect(session.sampled).toBe(true)
    expect(session.correlationId).toBe(correlationId)

    await session.span("usage_admission", async () => "ok")
    session.counter("accepted")
    const lines = log.mock.calls.map((call) => JSON.parse(String(call[0])))
    expect(lines[0]).toMatchObject({
      _tag: "chat_perf",
      event: "server_span",
      span: "usage_admission",
      ok: true,
      correlationId,
    })
    expect(lines[1]).toMatchObject({
      event: "checkpoint",
      kind: "accepted",
      correlationId,
    })
  })

  it("drops an invalid header silently and emits without correlation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const session = createChatPerfServerSession("Bearer sk-abcdefgh12345678", {
      rate: 1,
      random: () => 0,
    })
    expect(session.correlationId).toBeUndefined()
    await session.span("auth_session", async () => null)
    const line = JSON.parse(String(log.mock.calls[0]?.[0]))
    expect(line.correlationId).toBeUndefined()
    expect(JSON.stringify(line)).not.toContain("sk-abcdefgh")
  })

  it("closes spans on failure with ok=false and never attaches the error", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const session = createChatPerfServerSession(null, {
      rate: 1,
      random: () => 0,
    })
    await expect(
      session.span("credential_resolution", async () => {
        throw new Error("boom: sk-ant-api03-supersecret000 leaked?")
      })
    ).rejects.toThrow("boom")
    const line = JSON.parse(String(log.mock.calls[0]?.[0]))
    expect(line).toMatchObject({
      event: "server_span",
      span: "credential_resolution",
      ok: false,
    })
    expect(JSON.stringify(line)).not.toContain("sk-ant")
    expect(JSON.stringify(line)).not.toContain("boom")
  })

  it("exposes the header name the client transport sends", () => {
    expect(CHAT_PERF_ID_HEADER).toBe("x-chat-perf-id")
  })
})
