import * as Sentry from "@sentry/nextjs"
import posthog from "posthog-js"
import {
  sentryBeforeBreadcrumb,
  sentryBeforeSend,
  sentryBeforeSendSpan,
} from "./lib/observability/sentry-scrubbing"
import { sentryTracesSampler } from "./lib/observability/sentry-tracing"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,
  sendDefaultPii: false,
  tracesSampler: sentryTracesSampler,
  beforeSend: sentryBeforeSend,
  beforeSendSpan: sentryBeforeSendSpan,
  beforeBreadcrumb: sentryBeforeBreadcrumb,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
})

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY

if (posthogKey && !posthog.__loaded) {
  posthog.init(posthogKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: false,
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart

// Opt-in until the instrumented/uninstrumented browser comparison is reviewed.
// Browser INP remains Sentry's native metric; these are named chat DOM/frame proxies.
const chatUiSampleRate = Number(
  process.env.NEXT_PUBLIC_CHAT_UI_SAMPLE_RATE ?? 0
)
const chatUiBenchmark =
  process.env.NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION === "true"
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
            attributes: { measurement: "dom-frame-v1" },
          })
        },
      })
    )
    .catch((error) => Sentry.captureException(error))
}
