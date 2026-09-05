import { afterEach, expect, it, vi } from "vitest"
import * as Sentry from "@sentry/nextjs"
import posthog from "posthog-js"
import { installChatUiObserver } from "./lib/observability/chat-ui-observer"

vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  replayIntegration: vi.fn(() => ({ name: "Replay" })),
  captureRouterTransitionStart: vi.fn(),
  captureException: vi.fn(),
}))
vi.mock("posthog-js", () => ({ default: { init: vi.fn(), __loaded: false } }))
vi.mock("./lib/observability/chat-ui-observer", () => ({ installChatUiObserver: vi.fn() }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  performance.clearMarks("chat-perf:replay_disabled_v1")
})

it.each([false, true])("keeps production replay behavior and disables it only for benchmark=%s", async (benchmark) => {
  vi.resetModules()
  vi.stubEnv("NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION", String(benchmark))
  vi.stubEnv("NEXT_PUBLIC_CHAT_UI_SAMPLE_RATE", "0")
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "test-key")
  await import("./instrumentation-client")
  await vi.dynamicImportSettled()
  expect(installChatUiObserver).toHaveBeenCalledTimes(benchmark ? 1 : 0)
  expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({
    integrations: benchmark ? [] : [{ name: "Replay" }],
    replaysSessionSampleRate: benchmark ? 0 : 0.1,
    replaysOnErrorSampleRate: benchmark ? 0 : 1,
    tracesSampler: expect.any(Function),
    beforeSend: expect.any(Function),
  }))
  expect(Sentry.replayIntegration).toHaveBeenCalledTimes(benchmark ? 0 : 1)
  expect(posthog.init).toHaveBeenCalledWith("test-key", expect.objectContaining({
    person_profiles: "identified_only",
    capture_pageview: false,
    ...(benchmark ? { disable_session_recording: true } : {}),
  }))
  if (!benchmark) {
    expect(vi.mocked(posthog.init).mock.calls[0][1]).not.toHaveProperty("disable_session_recording")
  }
  expect(performance.getEntriesByName("chat-perf:replay_disabled_v1")).toHaveLength(benchmark ? 1 : 0)
})
