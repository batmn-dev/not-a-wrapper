# ADR-0037: Measure chat responsiveness through a small set of user journeys

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
An observer checks the intended DOM state in a rendering callback, then timestamps
in a cancellable task queued from that callback, after its rendering opportunity.
This follows the [rAF-to-timer pattern](https://web.dev/articles/optimize-inp#yield_to_allow_rendering_work_to_occur_sooner).
Measurement version `dom-frame-v2` removes v1's extra animation-frame wait; old
captures cannot be compared or adjusted by subtracting a fixed frame duration.
These are explicitly DOM/frame proxies,
not compositor or first-pixel measurements. Existing React-effect timings retain
their historical definitions as diagnostic columns. Traces remain the authority
when investigating actual presentation delay.

The browser trace confirmed that even the earlier double-rAF proxy could precede
native Event Timing presentation. Neither version establishes physical pixel
presentation or an upper bound on it. DOM inspection remains before rendering;
moving the inspection into the later task could credit a mutation after the frame.

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
Instrumented benchmark builds disable session replay and declare the required
`replayPolicy: disabled-v1` dimension. This holds remotely configured and sampled
recording work out of the controlled chat workload; production replay remains
unchanged. Earlier replay-enabled captures cannot seed these baselines.
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

## Hosted-run follow-through

The first CI run exposed observer blind spots (popup positioning style changes and
ARIA-disabled Send), not just application latency. Stop correctness records
current-assistant source lengths at idle feedback, after 250 ms, and after the
terminal/settlement wait and settling buffer. Growth between checkpoints fails;
a shorter canonical terminal snapshot remains valid. These are sampled stability
checks, not continuous mutation coverage. Terminal feedback is measured only from a real
terminal event, separately from Stop feedback. Receipt-to-terminal ordering is a
signed diagnostic because the durable receipt can arrive first.
Authenticated Stop runs require that receipt before their final length check.

Long-task and rAF-gap marks retain the original observed interval. Aggregates
include full intervals overlapping Send through terminal, even when the callback
that emits the mark arrives after terminal; callback timestamps cannot hide the
last blocking task or frame gap. Streaming cleanup reports a remaining blocked
frame interval before cancelling its pending callback.

First-send motion uses the existing Composer lifecycle module to animate the live
form after its synchronous update, retaining the 500 ms shared spring. This avoids
blocking Send on full-document View Transition capture. Removing motion entirely
was considered; keeping the live-element slide preserves the interaction while
letting feedback begin immediately. Hidden/reduced-motion documents skip animation.
The composer also reuses identical sizing measurements across editor transactions
and controlled-value commits, invalidating on value, width, node, class, style or
computed typography and wrapping inputs.

Menu commands subscribe separately from changing message/list data. Memoized
sidebar adapters compare the complete chat value and their own active state;
inactive rows need not rebuild their menu controls when another chat is selected.
Reset remains scoped to the selected chat, and only its active menu receives the
reset command. Delete confirmation mounts on first request and remains mounted
through later closes so its existing transition lifecycle is retained. Splitting
the command subscriptions extends the existing providers; a new shared state
system or disabling menu behavior was unnecessary.

Highlight styling is scoped to the streaming root and inherited by descendants.
The overlay observes its last block with IntersectionObserver. Once that block is
offscreen, a bounded grace interval lets preceding visible cohorts finish, then
range repainting pauses. Appends still advance cohort state, so scrolling into the
tail resumes only current cohorts. No text or wrapper nodes are inserted. A large
intersecting block remains eligible conservatively. The current native text-length
read is retained for visible repainting because child-only Markdown renders can
change text-node extent between parent commits; stale cached offsets would tint
the wrong text.
