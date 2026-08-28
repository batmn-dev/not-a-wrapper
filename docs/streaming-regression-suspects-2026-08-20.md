# Streaming regression suspects — 2026-08-20

> **Status update 2026-08-28:** suspect 3 (sequential pre-stream Convex
> roundtrips) is RESOLVED — Experiment 1 (`8ebaa7ae`) overlapped the
> independent admission reads: receipt→provider-start 405 → 317 ms p50
> (details: `docs/performance/2026-08-28-experiment-1-prestream-roundtrips.md`).
> Suspects 1, 2, and 4 remain open and are tracked by TODO.md's "Assistant
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

1. **`maxOutputTokens` cap on platform-funded runs** (ADR-0021,
   `chat-turn-runtime.ts` ~1300). Platform runs are capped at 8,192 output
   tokens (+10k headroom for Anthropic fixed thinking only). Long answers
   truncate mid-stream (`finishReason: "length"`), and OpenAI/Google
   reasoning tokens burn the cap with **no headroom** — a heavy-thinking turn
   leaves little room for visible text. BYOK runs are uncapped, so the same
   model behaves differently per credential.
2. **Route flapping / silent credential switching** (#143 + ADR-0021).
   Observed live: gpt-5-mini ran `platform` → `priority_byok` →
   `fallback_byok` → `platform` within 40 minutes. Different credential =
   different upstream + different output cap per turn. Structural cause:
   `validateAndResolveChatCredential` supplies the route resolver's
   `platformFunding` context only when `isServerChatId(chatId)`
   (`app/api/chat/api.ts`), so **the first turn of a new chat (local optimistic
   id) can never take the platform tier** and may select an eligible priority
   or fallback BYOK route; otherwise, route resolution fails.
3. **Time-to-first-token grew by 1–2 sequential Convex roundtrips.**
   `usageAllowance.reserveAuthorized` mutation now sits on the admission
   critical path (`lib/model-route-resolver.ts`), and #143 added a per-turn
   `getKeySettings` query plus per-candidate `getUserKey` lookups —
   ~50–150 ms each, all before `streamText` starts.
4. **End-of-stream settle waits on the title call** (platform runs,
   `chat-turn-runtime.ts` `onEnd`). First turns can hold terminal settlement
   — and UI keyed off it (stop button, run status) — up to ~8 s after the
   last token while title usage arrives.
5. **`recordStep` fires a Convex mutation every step** (was tool-steps only).
   Fire-and-forget; minor write churn only.

## Symptom → suspect map

| Symptom | Suspect |
| --- | --- |
| Answers cut off / stream dies early | 1 (check `finishReason: "length"`) |
| Same model fast one turn, slow the next | 2 (check `credentialSource`/`routeReason` on runs) |
| Slow to start streaming | 3 |
| Spinner lingers after answer finished | 4 |
