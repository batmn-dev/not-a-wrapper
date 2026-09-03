# TTFT and tokens per second: not-a-wrapper vs T3 Chat (2026-09-02)

Live comparison of the production app (`www.not-a-wrapper.com`, Free tier,
Generation stats on) against T3 Chat (Pro plan, Stats for Nerds on), driven
through the same Chrome profile on the same machine and network. Raw per-turn
rows are in `2026-09-02-ttft-tps-vs-t3-runs.tsv` next to this file.

## Matrix as run

| Model | Ours | T3 Chat |
|---|---|---|
| GPT-5.6 Luna | effort **Off** (the menu's "none") | reasoning **Instant** (lowest of Instant/Low/Medium/High) |
| Claude Haiku 4.5 | as-is: fixed 5,000-token thinking budget, effort menu inert (label reads "Minimal") | T3 has no separate reasoning variant; it exposes the same Instant/Low/Medium/High control. Primary cell = **Low** (reasoning on, lowest). One extra cell at **Instant** (plain) for P1. |
| GLM-5.3 | effort **Low**, routes via OpenRouter | reasoning **Low** (only Low/High offered). Provider not shown in the composer; stream part ids are `gen-…` OpenRouter generation ids for every T3 model. |

Runs: ours 3 per cell (27 turns). T3 3 per cell for Luna and Haiku P1/P2,
then 1 per cell for Haiku P3 and all GLM cells at the user's request
(16 counted turns plus 3 Haiku-Instant). Fresh chat per turn, web search off,
no attachments, no custom instructions. Turns ran 23:39–00:40 UTC (ours) and
00:36–00:59 UTC (T3); interleaving was lost, see Method.

## Results (median per cell)

TTFT columns are not comparable with each other; the last column is.

| Cell | Ours TTFT ms (server, ADR-0030) | Ours tok/s | Ours out tokens | T3 "Time-to-First" s | T3 tok/sec | T3 tokens | Send → first text chunk at client, ms: ours / T3 |
|---|---|---|---|---|---|---|---|
| Luna P1 | 1138 | 95.0 | 86 | 0.006 | 33.2 | 114 | **3817 / 2974** |
| Luna P2 | 673 | 75.7 | 246 | 0.004 | 48.7 | 246 | **1926 / 2871** |
| Luna P3 | 496 | 96.8 | 145 | 0.003 | 41.6 | 141 | **1326 / 2682** |
| Haiku P1 | 3331 | 177.4 | 411 (≈200 reasoning) | 0.003 | 73.0 | 399 | **4148 / 4899** |
| Haiku P2 | 2741 | 116.7 | 410 (≈120 reasoning) | 0.005 | 63.7 | 378 | **3819 / 3717** |
| Haiku P3 | 3266 | 579.7 (see anomaly) | 506 (≈300 reasoning) | 0.074 (n=1) | 107.9 | 583 | **4154 / 5612** |
| Haiku P1, T3 at Instant | | | | 0.003 | 41.1 | 157 | — / 3071 |
| GLM P1 | 10135 (see anomaly) | 167.8 | 127 | 0.007 (n=1) | 72.2 | 193 | **11153 / 1685** |
| GLM P2 | 1167 | 132.2 | 255 | 0.003 (n=1) | 49.9 | 253 | **2132 / 3049** |
| GLM P3 | 1375 | 151.3 | 177 | 0.003 (n=1) | 64.7 | 173 | **2624 / 1551** |

Per-run values (ours; T3) for the comparable column, ms:

- Luna P1: 3993, 3817, 1731; 2974, 3162, 2273
- Luna P2: 1926, 1588, 2200; 2688, 2871, 2911
- Luna P3: 1326, 1202, 1423; 2682, 2772, 2565
- Haiku P1: 4148, 3388, 4567; 4899, 6418, 4314
- Haiku P2: 3819, 4806, 2879; 3185, 3717, 5622
- Haiku P3: 3666, 4154, 11137; 5612
- GLM P1: 3044, 12682, 11153; 1685
- GLM P2: 2132, 14253, 1934; 3049
- GLM P3: 2210, 13366, 2624; 1551

Read-outs:

- **Luna, the like-for-like non-reasoning cell:** once the reply is longer
  than a few lines we reach first text ~0.7–1.4 s sooner than T3 (P2, P3).
  On the shortest prompt T3 wins by ~0.8 s because two of our three runs spent
  2.2–2.5 s before the stream headers (see Where the time goes).
- **Haiku:** roughly even. Both apps stream Anthropic's thinking before the
  text; ours reads 2.6–3.7 s provider TTFT with the fixed 5,000 budget, T3's
  "Low" lands text 0.6–1.5 s later than us on P1/P3 and slightly earlier on P2.
- **GLM-5.3:** T3 is consistently 1.5–3 s on every prompt. Ours is 1.9–3 s
  when the route behaves and 11–14 s on the four runs hit by the anomaly below.
- **tok/s cannot be compared across the two apps.** Ours divides visible
  tokens by the post-first-output window (reasoning excluded). T3's figure is
  a fraction of ours for the same token count (Luna P2: 246 tokens both,
  75.7 vs 48.7), so it is almost certainly tokens over a window that starts
  earlier (send or headers) and, for reasoning models, counts reasoning tokens
  (their Haiku "tokens" rises to 399–583 with reasoning on and never breaks
  out a reasoning share).
- **T3's "Time-to-First" is not time to first token.** It reads 0.003–0.074 s
  on every turn while their own stream shows the first text chunk 1.5–5.6 s
  after send. Treat it as an internal delta, not a latency.

## Where the time goes (client-side stream timing)

Both apps stream the AI SDK UI protocol (`start`, `start-step`,
`text-start`, `text-delta`). Measured in the page from the send click:

| Segment | Ours | T3 |
|---|---|---|
| Click → `/api/chat` request leaves | 0.32–0.75 s (a `/api/rate-limits` call comes first) | ~0.9 s (event + server-version + three serverFn + tRPC calls first) |
| Request → response headers (`start`) | 0.5–2.3 s | 0.0–0.9 s |
| Headers → `start-step` (provider dispatch waits on this) | 0.2–1.1 s, up to 3.2 s | 0.9–2.5 s |
| `start-step` → first `text-delta` (≈ provider TTFT) | Luna 0.01–0.2 s after start-step; Haiku/GLM see the table | Luna 0.02 s; Haiku 1.5–2.8 s of reasoning deltas first |

So our pre-provider overhead (rate-limit round trip + admission + Convex
first-turn creation before headers) is 1.0–2.6 s on a cold-ish path and is
the whole reason T3 wins Luna P1. T3 spends its overhead before the request
leaves instead.

## Anomalies worth their own investigation

1. **Five of 27 of our turns arrived as one burst after ~10 s.** Haiku P3
   run 3 (TTFT 10,251 ms, output window 47 ms, 7 SSE chunks) and GLM P1 run 3,
   P3 run 2, plus GLM P1 run 2 / P2 run 2 at 11.7–13.4 s TTFT. The SDK clock is
   upstream of our pacing, so the delay is provider/gateway side, but the
   repeat of ~10.1 s across Anthropic and OpenRouter looks like a timeout or
   fallback, not model latency. It also breaks the stats line: a 47–257 ms
   window turns tok/s into 300–4,272. T3's GLM never showed it (n=3).
2. **The OpenAI route ships a 4,480-token system prompt** (4,412 cached).
   Haiku sees 1,026 and GLM 552. Luna TTFT carries that prefill every turn.
3. **Server prep before the stream headers is 0.5–2.3 s** and varies run to
   run (Luna P1: 2.5, 2.8, 1.1 s). This is the segment ADR-0030 says we own
   and may gate.

## Method and caveats

- **Stats capture.** Ours: the Generation stats line plus its tooltip
  (exact ms, reasoning share, input tokens) read from the DOM. T3: the Stats
  for Nerds line under each reply.
- **"Send → first text chunk"** replaces the 60 fps screen recording, which
  could not be done in this session. A page script stamps the send click,
  then tees the `/api/chat` response body and records the first
  `text-delta` chunk. It is the same measurement on both apps and excludes
  only the final paint (a DOM observer on our assistant message showed
  30–150 ms after the chunk; T3's accessible article appears ~2 s after its
  first chunk because it renders streaming text elsewhere first).
- **Tab visibility.** The Chrome window sat behind the desktop app for most of
  the session. Our tab hydrated and streamed hidden; T3's client never
  hydrates hidden, so its turns ran only after the tab was shown and were
  kept alive with in-app New Chat instead of reloads. Hidden-tab timer
  throttling does not touch these measurements (server stats, fetch
  callbacks), but it did make DOM-paint timing unusable, hence the chunk-level
  metric.
- **Interleaving was lost.** Ours ran 23:39–00:40 UTC, T3 00:36–00:59 UTC,
  so provider load was not shared per cell as the protocol wanted.
- **Input.** Extension typing does not reach a hidden tab, so prompts were
  inserted with the editor's `insertText` command (ours) or the textarea's
  React `onChange` (T3) and Send was clicked from page script. The send
  timestamp is the click.
- **Smooth text streaming** stayed on in our app (default). It sits after the
  point where both the server stats and the chunk metric are measured.
