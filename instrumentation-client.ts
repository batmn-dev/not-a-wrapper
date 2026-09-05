import * as Sentry from "@sentry/nextjs"
import posthog from "posthog-js"
import {
  sentryBeforeBreadcrumb,
  sentryBeforeSend,
  sentryBeforeSendSpan,
} from "./lib/observability/sentry-scrubbing"
import { sentryTracesSampler } from "./lib/observability/sentry-tracing"

const chatUiBenchmark =
  process.env.NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION === "true"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,
  sendDefaultPii: false,
  tracesSampler: sentryTracesSampler,
  beforeSend: sentryBeforeSend,
  beforeSendSpan: sentryBeforeSendSpan,
  beforeBreadcrumb: sentryBeforeBreadcrumb,
  // Deterministic captures exclude remotely configured/random replay work.
  integrations: chatUiBenchmark ? [] : [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],
  replaysSessionSampleRate: chatUiBenchmark ? 0 : 0.1,
  replaysOnErrorSampleRate: chatUiBenchmark ? 0 : 1,
})

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY

if (posthogKey && !posthog.__loaded) {
  posthog.init(posthogKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: false,
    ...(chatUiBenchmark ? { disable_session_recording: true } : {}),
  })
}

if (chatUiBenchmark) performance.mark("chat-perf:replay_disabled_v1")

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart

// Opt-in until the instrumented/uninstrumented browser comparison is reviewed.
// Browser INP remains Sentry's native metric; these are named chat DOM/frame proxies.
const chatUiSampleRate = Number(
  process.env.NEXT_PUBLIC_CHAT_UI_SAMPLE_RATE ?? 0
)
if (
  chatUiBenchmark ||
  (Number.isFinite(chatUiSampleRate) &&
    Math.random() < Math.min(1, Math.max(0, chatUiSampleRate)))
) {
  void import("./lib/observability/chat-ui-observer")
    .then(({ installChatUiObserver }) =>
      installChatUiObserver({
        resumeOnVisible: !chatUiBenchmark,
        report(metric, durationMs) {
          if (chatUiBenchmark) {
            console.info(
              JSON.stringify({ _tag: "chat_ui_perf", metric, durationMs })
            )
            return
          }
          Sentry.metrics.distribution(`chat.ui.${metric}`, durationMs, {
            unit: "millisecond",
            attributes: { measurement: "dom-frame-v3" },
          })
        },
      })
    )
    .catch((error) => Sentry.captureException(error))
}
