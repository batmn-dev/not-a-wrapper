# Streaming regression suspects — 2026-08-20

> **Status update 2026-08-28:** suspect 3 (sequential pre-stream Convex
> roundtrips) is RESOLVED — Experiment 1 (`8ebaa7ae`) overlapped the
> independent admission reads: receipt→provider-start 405 → 317 ms p50
> (details: `docs/performance/2026-08-28-experiment-1-prestream-roundtrips.md`).
> Suspects 1 and 2 remain open and are tracked by TODO.md's "Assistant
> responsiveness" item.

Perceived text-streaming degradation investigated against the last two changes:
`b1e3ce8c` (platform usage allowance, ADR-0021) and `eea6a30d` (#143, logical
model identities + server-owned route selection).

## What was ruled out

- **Client render path untouched.** Neither change modified the markdown
  renderer, word-chunking transform, render throttle, or `useChat` wiring
  (only a tooltip refactor and a removed toast).
- **Provider throughput is normal** in dev `generationRuns` rows post-change
  (gpt-5.4-mini 76–139 tok/s, opus 64 tok/s; prepare→work ~50–110 ms).
- **Allowance exhaustion is not the cause**: 975,885 / 1,000,000 credits
  remained at time of check.

## Suspects, ranked

1. **Platform generation budget** (ADR-0028, `chat-turn-runtime.ts` ~1490).
   Platform response policy allows 8,192 tokens; fixed Anthropic thinking adds
   separately billed reservation headroom. Long answers truncate mid-stream
   (`finishReason: "length"`), and OpenAI/Google reasoning tokens share the
   8,192-token allowance, so a heavy-thinking turn leaves little room for
   visible text. BYOK Auto omits the provider limit, while an explicit manual
   retry can apply a shorter budget.
2. **End-of-stream settle waits on the title call** (platform runs,
   `chat-turn-runtime.ts` `onEnd`). First turns can hold terminal settlement
   — and UI keyed off it (stop button, run status) — up to ~8 s after the
   last token while title usage arrives.
3. **`recordStep` fires a Convex mutation every step** (was tool-steps only).
   Fire-and-forget; minor write churn only.

## Symptom → suspect map

| Symptom                               | Suspect                            |
| ------------------------------------- | ---------------------------------- |
| Answers cut off / stream dies early   | 1 (check `finishReason: "length"`) |
| Spinner lingers after answer finished | 2                                  |
