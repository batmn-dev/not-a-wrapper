# ADR-0035: Measure chat responsiveness through a small set of user journeys

Status: accepted, 2026-09-04

## Decision

Extend the existing deterministic browser harness and Sentry integration. Do not
introduce a second test framework, change default model/tool behavior to improve
scores, or use real-provider latency as an application regression gate.

The core journeys cover cold HTTP-cache entry, a follow-up in an existing chat,
reasoning before text, interaction during a long answer, Stop, and error recovery.
One constrained CPU/network variant represents lower-headroom devices. The existing
thread-switch suite covers visited/unvisited destinations; the scheduled standard
and durable suites retain rendering stress and recovery correctness.

Browser measurements begin at the activating click or Enter event's timestamp.
The guarded Composer submit handler confirms the input; consuming Enter in an
editor menu never resets the active measurement. Coalesced typing preserves the
oldest input awaiting a frame. Late interactions wait for 80% of deterministic
fixture content, with separate early/late coverage requirements.
An observer checks the intended DOM state before a frame, then timestamps after
that frame has had a paint opportunity. These are explicitly DOM/frame proxies,
not compositor or first-pixel measurements. Existing React-effect timings retain
their historical definitions as diagnostic columns. Traces remain the authority
when investigating actual presentation delay.

A sampled transport text-length watermark is matched to the current assistant's
rendered source length to measure receipt-to-content-frame delay throughout the
answer. This measures source committed into a visible Markdown container; it does
not prove every character in an off-screen block was painted. Source text, element
identities, navigation destinations, and watermark lengths never enter telemetry.
Each stream binds to the active measurement turn so a detached stream cannot
contaminate a later send. Generic Thinking feedback is distinct from actual
inspectable reasoning/tool activity.

Result schema v2 carries complete scenario identity, fixture script hash, browser,
hardware, cache, network, authentication, and measurement-version dimensions.
Comparisons reject missing baselines, missing/failed samples, duplicate identities,
and incompatible conditions. Baseline collection is an explicit operation, never
a silent successful comparison. Five or more measured runs are required for a
comparison; p95 is omitted below 20 observations. Raw measurements and sample
counts remain available, and slow input samples are never dropped for being slow.
Summaries are checked against raw UI samples. Completed foreground runs fail on
unmatched received-content samples; any observation overflow fails explicitly.

Normal-profile feedback budgets are 100 ms for Send/Stop/menu response and 50 ms
for typing and sampled content-frame delay, with at most 5% exceeding the budget.
Relative comparisons additionally catch changes to preparation, load, first output,
and navigation. Constrained-device results have their own relative baselines;
the normal-profile absolute budgets do not silently become phone guarantees.

Production DOM observation uses the existing Sentry metric transport, with only
closed metric names and durations. `NEXT_PUBLIC_CHAT_UI_SAMPLE_RATE` defaults to
zero until observer overhead has been measured and reviewed. Instrumented builds
also support content-free console evidence in authenticated Chrome. Sentry's native
INP remains the general interaction metric; individual Event Timing samples are
not mislabeled as INP.

## Alternatives considered

A larger provider/model/viewport Cartesian matrix would multiply runtime and noise
without testing a new user interaction. Generic Web Vitals alone would miss the
asynchronous wait between Send and useful output. Replacing the harness would
throw away its useful stream correctness and server timing contracts.

## Validation boundary

Unit tests prove the observer and comparison contracts, not application speed.
A production build plus authenticated-browser checks validate integration. A new
runner-matched baseline, foreground browser capture, and instrumentation-overhead
comparison are required before declaring release performance validated. Old v1
artifacts must not be copied into v2 baseline files. Missing baselines fail CI.
