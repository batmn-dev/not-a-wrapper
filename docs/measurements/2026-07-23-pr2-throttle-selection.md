# PR 2 — message-notification throttle selection (2026-07-23)

Historical selection record for PR 2: the value passed to
`useChat({ chat, throttle })` via the former
`NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE` flag, compared at 0/32/50/100 ms against
deterministic streams. **Selected value: 50 ms.** After verification, the flag
was removed and 50 ms became the unconditional `CHAT_MESSAGE_THROTTLE_MS`
value; see [`2026-07-23-flag-collapse.md`](./2026-07-23-flag-collapse.md).

## Method

Deterministic harness: the fake-timer matrix test in
`app/components/chat/use-chat-core.ai-sdk-seam.test.tsx`
("coalesces streamed notifications per interval …") drives the REAL
`@ai-sdk/react@4.0.23` `useChat` + supplied `Chat` + `DefaultChatTransport`
against a genuine v7 UI-message SSE stream (30 text deltas) at 10/30/100
chunks/s under a virtual clock. It records one frame per React commit whose
messages-array identity changed — the delivered message-notification count,
which is 1:1 with commits at this seam — plus the virtual time of the first
commit containing assistant text. Counts are exact (no sampling, no wall
clock); reproduce with:

```bash
bunx vitest run app/components/chat/use-chat-core.ai-sdk-seam.test.tsx --disable-console-intercept
```

Environment: Apple M4 Max (16 cores), macOS 25.5.0 arm64, Node v25.8.1,
vitest 4.1.9, repo @ `7228afaa` + PR 2 changes. Environment affects nothing
here — all timing is virtual.

## Results (30-delta stream; notifications == React commits at this seam)

| chunks/s | interval | delivered notifications | reduction vs 0 ms | first-text delay (virtual) |
| -------- | -------- | ----------------------- | ----------------- | -------------------------- |
| 100      | 0 ms     | 36                      | —                 | 10 ms                      |
| 100      | 32 ms    | 15                      | −58%              | 10 ms                      |
| 100      | 50 ms    | 11                      | −69%              | 10 ms                      |
| 100      | 100 ms   | 8                       | −78%              | 10 ms                      |
| 30       | 0 ms     | 36                      | —                 | 33 ms                      |
| 30       | 32 ms    | 36                      | 0%                | 33 ms                      |
| 30       | 50 ms    | 25                      | −31%              | 33 ms                      |
| 30       | 100 ms   | 15                      | −58%              | 33 ms                      |
| 10       | any      | 36                      | 0%                | 100 ms                     |

## Why 50 ms

- **Reduction where it matters.** Fast streams (≈100 chunks/s — the case that
  produced the measured render pressure) drop 69% of notifications/commits at
  50 ms vs 58% at 32 ms. At 30 chunks/s, 32 ms sits below the chunk period and
  coalesces **nothing**, while 50 ms still removes 31%. Slow streams (10
  chunks/s) are untouched by every candidate — the throttle is inert exactly
  where there is no problem.
- **First visible text is unaffected at every value** (10/33/100 ms — the
  first chunk's own arrival time). The status subscription is not throttled;
  the `submitted → streaming` transition re-renders immediately and React
  re-reads the messages snapshot in that same commit, so the leading text
  never waits for a throttle window. The acceptance bound (interval + baseline
  allowance) holds with margin.
- **100 ms is the stress comparator only:**
  its extra reduction (−78% vs −69%) buys visible burstiness at 30 chunks/s
  (10 updates/s cadence) for little marginal render savings.
- **Terminal/approval/tool updates are not delayed:** `onFinish`, Stop
  settlement, error, approval resolution, and auto-send continuation run on
  unthrottled paths (pinned by the PR 2 seam tests; the finish-time status
  render also delivers the final parts without waiting for the trailing
  window).

## Acceptance gates

- Material reduction vs 0 ms: **yes** — −69% (100 chunks/s) / −31%
  (30 chunks/s) at the selected 50 ms.
- p95 first-chunk-to-visible-text bounded by interval + allowance: **yes** —
  measured delay equals the 0 ms baseline in every combo.
- No lost final/approval/tool/source/error/terminal update: **yes** — final
  UIMessage deep-equals the 0 ms baseline at every value; Stop/error/approval/
  continuation covered by dedicated fake-timer tests in the same file.

## Historical rollout caveats

- At this decision point, the production-build **visual** side-by-side
  (streaming texture, Composer keypress feel, 4× CPU slowdown) remained a
  staging requirement:
  `NEXT_PUBLIC_` flags were build-time-inlined, so per-value comparison
  required separate builds — they could not be flipped on a running dev
  server. The quantitative selection above did not depend on it; texture
  concerns argued for 50 over 100, not for/against enabling.
- React-commit counts here are commits at the `useChat` seam. Downstream
  render cost per commit (Markdown/Shiki) is PR 3's territory.
