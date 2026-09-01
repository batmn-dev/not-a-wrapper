# ADR-0030: Run timing receipt and SDK-sourced provider timing

**Status:** Accepted
**Date:** 2026-09-01

## Context

Two needs arrived together. Users want a per-response stat line (time to
first token, token counts, tokens per second) like other chat clients ship.
Engineers need to tell, per build and per model route, whether a change made
turns slower.

The existing chat-performance seam (ADR-era docs in `docs/performance/`) is
deliberately off by default, sampled to structured logs, and never persisted
to any document. It cannot answer "did build X regress prepare time for
OpenRouter routes" without a log tool and a non-zero production sample rate.

The provider spans that seam emits today (`provider_first_event`,
`provider_first_text_delta`) are measured in the AI SDK's chunk callback,
which runs after every `experimental_transform`. The evidence-gated word
chunking transform paces text with timers, so for smoothing-eligible models
those spans include this server's own holdback delay.

AI SDK 7 measures each model call itself: a monotonic clock anchored
immediately before the provider request, sampled inside the step stream
upstream of all transforms, exposed as `StepResult.performance`
(`timeToFirstOutputMs`, `responseTimeMs`, `toolExecutionMs`, inter-chunk gap
percentiles) alongside per-step usage.

## Decision

1. **Provider timing has one source: the SDK step performance figures.**
   Both the user-facing **Generation stats** on the assistant message and
   the engineering **Run timing receipt** on the generation run read the same
   per-step values. No hand-rolled first-chunk or last-chunk clocks remain in
   the chunk callback. The chat-performance seam re-sources its provider span
   from the same figure (`provider_first_output` replaces
   `provider_first_event`); `provider_first_text_delta` is re-documented as a
   transport metric, since measured post-transform that is what it is.

2. **The Run timing receipt is always-on application data.** Every terminal
   write (completed, aborted, failed) stamps optional duration fields on the
   run row: server preparation, provider first output, first-write delay,
   model response, tool execution, wire stream window, settlement, plus a
   short build identity. Absent means unobserved; nothing is zero-filled. It
   holds durations and a build id only, never content or correlation ids, so
   the seam's privacy posture is unchanged. Per run, never accumulated across
   an approval continuation.

3. **Only segments this server owns may gate.** Prepare, first-write delay,
   pacing overhead, and settlement enter the weekly benchmark's gate table.
   Provider segments are a correctness check against the deterministic
   script's known delays and never a regression gate.

## Considered options

- **Sampled logs (existing seam) at a higher sample rate.** Rejected: not
  queryable by model, route, or build without external tooling, and the
  seam's design forbids the identifiers a join needs.
- **A PostHog event per turn.** Deferred, not rejected. Dashboards are nice,
  but the run row already holds usage and work duration, and the glossary
  keeps PostHog as a separate identity and sink domain. A mirror can be added
  later without changing the receipt.
- **A first-position raw stream tap for provider timing.** Rejected. It would
  give aborted runs a provider first-output figure, but it creates a second
  clock for the same quantity as the SDK's and reintroduces the class of
  measurement drift this decision removes. Aborted runs carry partial
  receipts instead.
- **Stamping the build identity at prepare.** Rejected: it changes the
  admission contract and signed proof for the sole gain of attributing runs
  that die before settlement, which the reaper already records by terminal
  reason.

## Consequences

- The 2026-08-27 baseline's provider rows for Claude Haiku 4.5 are
  post-transform contaminated and must not be compared with re-sourced
  figures. The metric dictionary carries a dated note.
- A new run index on status and completion time supports the windowed
  `timingSummary` query. The query is bounded and grouped by model, route,
  and build.
- Anyone adding a transform or changing prepare must expect the weekly gate
  to notice. That is the point.
