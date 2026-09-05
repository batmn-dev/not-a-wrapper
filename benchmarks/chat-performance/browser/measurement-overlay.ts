/** The original product revision; this overlay adds measurement hooks only. */
export const LEGACY_MEASUREMENT_BASE =
  "af97141b973e530ce579bea573a3534eb33a8d60"

export const LEGACY_MEASUREMENT_PATCH =
  "benchmarks/chat-performance/browser/measurement-overlay.patch"

/** Copy these exact implementations from the candidate into the legacy checkout. */
export const MEASUREMENT_FILES = [
  "lib/observability/chat-ui-observer.ts",
  "lib/observability/chat-ui-events.ts",
  "lib/observability/chat-performance.ts",
  "lib/observability/chat-responsiveness.ts",
  "lib/observability/composer-paint.ts",
] as const

/** Audit boundary for the patch. These files retain the original product code. */
export const MEASUREMENT_HOOK_FILES = [
  "instrumentation-client.ts",
  "app/components/chat-input/button-plus-menu.tsx",
  "app/components/chat-input/composer.tsx",
  "app/components/chat/message-assistant.tsx",
  "app/components/chat/thread-scroll-anchors.ts",
  "app/components/chat/thread-scroll-target.ts",
  "app/components/chat/thread-scroll.tsx",
  "app/components/chat/use-detachable-chat-stream.ts",
  "lib/chat-performance/message-throttle.ts",
] as const
