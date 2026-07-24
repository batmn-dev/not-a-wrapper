# Chat-perf follow-up measurements — mode-only build and mixed-markdown cells (2026-07-23)

Follow-up session to `2026-07-23-pr2-pr3-verification.md` (kept untouched here
because it is another session's uncommitted artifact; this doc closes its §5/§8
gaps and corrects two of its §9 observations). Authority:
`docs/gameplans/chat-responsiveness-performance-implementation-plan.md`
(§4, §8, PR 3, PR 7b). Branch `darknight/ten-nights-of-the-beast`, all builds at
commit `0aa5f7ff`.

**Bottom line:**

1. **Mode-only cannot ship alone.** A build with
   `NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE=throttled-highlight` and the message
   throttle UNSET reproduces the baseline's catastrophic code-stream pathology:
   one visible-tab run hard-froze the renderer for ≥7.5 minutes (recovered only
   by navigation), and a second run accumulated **42.8 s of blocked main-thread
   time with a single 12.1 s long task**. The PR 2 throttle is the load-bearing
   flag; PR 3's mode only caps highlight frequency, not per-delta React commits.
2. **Mixed-markdown (~10 KB, tables/lists/links, no code) is render-cheap in
   every config.** Baseline, throttle-only, and full-flag builds all recorded
   **zero long tasks** and typing p95 ≤ 15.6 ms during the stream. No
   flag-attributable difference exists on this scenario in either direction.
3. **Premise correction: the PR 0b turn marks were already emitted.**
   `first_chunk_received` and `first_visible_text` fired on every instrumented
   build in this session (`useChatTurnPerfMarks` is wired in
   `use-chat-core.ts` since `7228afaa`); the verification doc's §1 claim that
   the kit "defines but does not yet emit" them was a stale-grep error.
4. **§9 items 4/5 (composer Stop bugs) did not reproduce** on the same commit
   and build class under direct mid-stream DOM probing; details and the
   related real fix are below.

## 1. Environment

- Same machine/class as the verification doc: Apple M4 Max, macOS 25.5.0,
  signed-in Chrome, production `next build` (Turbopack) in detached worktrees,
  `PORT=<port> bun run start`, `.env.local` copied, `SENTRY_AUTH_TOKEN` emptied,
  `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION=true` everywhere.
- Model: GPT-5 Mini (app default), real OpenRouter streaming; per-run output
  size recorded (the model overshoots the 400-line request, consistent with the
  prior session).
- Injected instrumentation identical in kind to the prior session:
  `PerformanceObserver` (longtask), fetch `TransformStream` tap on `/api/chat`,
  keydown→`requestAnimationFrame` latency probe (discrete CDP key events),
  settle detection via the Copy action row. Additionally the **built-in PR 0b
  User-Timing marks** were read back per run (see §4).
- **Visibility discipline:** the machine was in active use by the user during
  this session, so every run records `visibilitychange` events and the
  tab-visibility state is annotated per run. One contaminated run (E1) is
  reported but excluded from conclusions.
- Servers used fresh ports 3015–3018; the user's dev server (:3000), :3001, and
  the pre-existing :3002 listener were never touched. All four scratch servers
  were stopped at session end.

## 2. Build matrix (this session)

| Config | Flags | Port | Worktree |
| --- | --- | --- | --- |
| E (mode-only, **new**) | `STREAMING_CODE_RENDER_MODE=throttled-highlight`, throttle **unset** | 3015 | session scratchpad `builds/wtE` (new) |
| A (baseline) | both unset | 3017 | prior session `builds/wtA` (reused) |
| B (throttle-only) | `CHAT_MESSAGE_THROTTLE=50` | 3016 | prior `builds/wtB` (reused) |
| C (full) | throttle=50 + `throttled-highlight` | 3018 | prior `builds/wtC` (reused) |

## 3. Cell (a) — mode-only build E, code-heavy scenario

Same prompt family as the prior session (single ≥400-line TypeScript module in
one code block; the model produced ~900-line blocks).

| Run | Tab | Outcome | Long tasks (count / total / max) | Notes |
| --- | --- | --- | --- | --- |
| E1 | visible→**hidden mid-run** | Completed; 902-line block, ~340 KB tapped before the tap stalled | unreliable (hidden) | Excluded from conclusions. Typing probe while still visible: med 8.7 ms, p95 14.4 ms (n=30). |
| E2 | **visible** | **Renderer hard-frozen** from ~38 s after send; every CDP eval timed out for ≥7.5 min; recovered only by force navigation. Run completed durably server-side (936-line block rehydrated on reload — §4.1.1 held). | n/a (client dead) | A-class outcome. |
| E3 | hidden from +6 s | Settled ~110 s; 811 chunks / 495 KB | **38 / 42.8 s / 12,078 ms** | Multi-second monolithic tasks even while hidden. |

Comparison points from the verification doc (visible, code-heavy): B2
(throttle-only) 232 / 23.3 s / 360 ms; C1–C2 (full) 38–77 / 3.2–6.9 s /
113–235 ms; A2 (baseline) froze then crashed the tab.

**Verdict (closes the §5 mode-only gap):** the mode-only build sits in the
baseline's failure class, not C's. `throttled-highlight` must NOT be enabled
alone while `NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE` stays held; PR 3's mode is only
shippable together with (or after) PR 2's throttle. Mechanism: the mode caps
*highlight* frequency, but with a 0 ms notification interval every SSE delta
still commits a full-block React re-render, and those commits grow with block
size until the main thread never yields.

## 4. Cell (b) — mixed-markdown scenario (~10 KB, tables/lists/links, NO code)

Prompt: an ~10 KB markdown comparison document (intro paragraph, one large
8×6 table, pros/cons bullet lists, 20 reference links, explicitly no code
fences). One clean visible run per config (n=1 each; all-zero long-task
results left nothing for a second run to tighten given provider-side variance
dominates every timing).

| Run | Config | Tab | Settle | Stream | Output | Long tasks | Typing during stream | first chunk | first visible text |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-MD1 | baseline | visible | 54 s | 1,864 chunks / 411 KB | ~9.5 KB | **0** | med 9.3 / p95 14.6 ms (n=30) | 665 ms (tap) / 671 ms (mark) | 34.0 s |
| B-MD1 | throttle | visible | 61 s | 2,533 chunks / 478 KB | ~8.5 KB | **0** | med 7.4 / p95 15.0 ms (n=30) | 782 ms (mark) | 16.5 s |
| C-MD1 | full | visible | 53 s | 2,591 chunks / 495 KB | ~9.8 KB | **0** | med 8.5 / p95 15.6 ms (n=30) | 755 ms (mark) | 14.7 s |

**Verdict (closes the §8 scenario-(b) gap):** markdown-only streams of this
size are render-cheap in every config — zero long tasks anywhere, typing
latency flat across configs. The 14.7–34.0 s first-visible-text spread is
GPT-5 Mini's server-side reasoning phase (provider noise), consistent with the
prior session's finding that first-text is not throttle-attributable. The
flags neither help nor hurt this scenario; nothing here blocks the recommended
enablement sequence.

## 5. Premise correction — PR 0b turn marks already emit

The verification doc (§1) stated the PR 0b kit "defines but does not yet emit
`first_chunk_received` / `first_visible_text`", and the follow-up work item
repeated it. Both are wrong: `useChatTurnPerfMarks` (in
`lib/observability/chat-performance-client.ts`) has been called from
`use-chat-core.ts` since commit `7228afaa`, and this session observed the
marks on every instrumented build. Example (E1): `chat_send_intent@+7 ms`,
`request_dispatched@+255 ms`, `first_chunk_received@+720 ms` — 6 ms after the
fetch tap saw the first `/api/chat` chunk at +714 ms — and
`first_visible_text@+18.5 s` (end of the reasoning phase). The likely origin of
the error is a grep for `markChatPerf(` call sites that discounted the
emissions inside `lib/observability/` as "the kit itself".

Two real gaps were found and fixed in this session instead (see the
accompanying commits): `first_visible_text` did not populate its schema's
`textLengthBucket` field, and the turn-fact derivation in `use-chat-core.ts`
had no current-turn boundary — in a chat with history the previous turn's
settled assistant text satisfied "visible text", so `first_visible_text` would
have fired at first-chunk time on every follow-up turn. The derivation now
stops at the trailing user message (pure function
`deriveChatPerfTurnFacts`, covered by tests).

## 6. §9 items 4/5 (composer Stop) — not reproducible; adjacent real gap fixed

Probed mid-stream on build E (same commit/build class as the original
observation), visible tab, real CDP key events:

- During a live code stream with an **empty** composer: the primary button was
  `aria-label="Stop"`, stop glyph, enabled.
- After typing 30 draft characters mid-stream: **still** `aria-label="Stop"`,
  stop glyph, enabled.

Neither "aria-label stays Send message while acting as Stop" (item 4) nor
"draft text turns the button into Send with no reachable Stop" (item 5)
reproduced, and the composer code cannot produce item 4 as written (icon and
label derive from the same resolved object). The plausible origin is DOM
inspection against a frozen/stale renderer (config A) or during the
pre-acceptance window below.

One real reachability gap in the claimed direction was verified in code and
fixed: during the **pre-acceptance dispatch window** (submit in flight, run
identity not yet known — `isSubmitting` true, resolver `stoppable` false) the
button presented as a disabled "Send message" instead of a Stop control. Per
the ChatGPT pattern (a Stop control for the whole in-flight turn) the composer
now presents Stop through that window, routed to the existing orchestrated
stop — which already cancels a pre-transport dispatch locally or arms a
deferred Stop pinned to the run this dispatch creates, preserving §4.1.4
exact-run semantics. The pinned behavior "a resolver-declined Stop is not
resurrected by local streaming status" is unchanged and still test-covered.

## 7. Artifacts

- New worktree (retained): this session's scratchpad `builds/wtE`
  (`git worktree remove --force <path>` when no longer needed); prior-session
  worktrees wtA–wtD reused in place.
- Servers on 3015/3016/3017/3018 stopped; :3000/:3001/:3002 untouched.
- Test chats created in the account this session (dev + scratch builds):
  two failed/aborted probe turns on :3000 (one froze the dev tab, recovered by
  navigation; durable run settled server-side), E1/E2/E3 code runs, A-MD1 /
  B-MD1 / C-MD1 mixed-markdown runs.
- BYOK note: the account's OpenAI/Exa keys were re-saved by the user mid-
  session (fixing the stale-ciphertext misses); early :3000 probe turns failed
  with "Something went wrong generating the response" before that.
