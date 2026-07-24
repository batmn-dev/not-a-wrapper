# PR 2 + PR 3 verification — correctness and tangible performance (2026-07-23)

Independent verification of commits `26cd10b4` (PR 2, message-notification
throttle) and `0aa5f7ff` (PR 3, streaming code rendering), diffed against
`7228afaa`, on branch `darknight/ten-nights-of-the-beast`. Authority:
`docs/gameplans/chat-responsiveness-performance-implementation-plan.md`
(PR 2/PR 3 sections, §4, §8, §9). Claims checked against
`2026-07-23-pr2-throttle-selection.md` and
`2026-07-23-pr3-streaming-code-decision.md`.

**Bottom line:** every quantitative claim in both measurement docs
reproduced; the live performance difference is not merely tangible, it is
categorical — the baseline build **froze for 17+ minutes** and later
**crashed the renderer tab** on a ~950-line code stream, while the
throttle+throttled-highlight build streamed the same workload with a worst
long task of 235 ms and typing p95 of 16 ms. One **blocking anomaly** was
found before production enablement: reloading a chat during the post-Stop
unsettled window hard-froze the tab on both flag-enabled builds but not on
the pre-PR or flags-off builds (evidence graded below; not fully
attributed). Recommendation: fix/clear that anomaly, then enable both flags
as recommended.

## 1. Environment

- Apple M4 Max (16 cores), macOS 25.5.0 arm64; Node v25.8.1 for tests/bench.
- Production builds: `next build` (Turbopack) in detached git worktrees under
  the session scratchpad (so the user's `next dev` on :3000 and its `.next`
  were never touched), served with `PORT=<port> bun run start`, `.env.local`
  copied per worktree, `SENTRY_AUTH_TOKEN` emptied for builds.
- All builds include `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION=true`. Note: the
  lean PR 0b kit defines but does not yet emit `first_chunk_received` /
  `first_visible_text` client marks, so browser metrics came from injected
  instrumentation: `PerformanceObserver` (longtask + event timing), a fetch
  `TransformStream` tap on `/api/chat` (chunk/byte/first-chunk timing), a
  MutationObserver scoped to `.markdown` (first visible text), and a
  keydown→`requestAnimationFrame` latency probe (real CDP key events).
- Driven through the user's signed-in Chrome (session carried across
  localhost ports). Tab visibility was verified per run after discovering the
  driven tab was `visibilityState: hidden` for the first two runs (A1, B1) —
  hidden tabs pause rAF and batch timers, so those two runs are marked
  *(hidden)* and later runs were done with the window raised and visible.
- Chrome's DevTools 4× CPU throttle is not reachable through the extension;
  the stressed cell uses an injected main-thread contention loop (30 ms busy
  per 40 ms ≈ 75% duty) started after send. Labeled *synthetic-load*; it is a
  contention proxy, not a clock-rate scale.
- Model: GPT-5 Mini (app default), real OpenRouter streaming. The shared
  prompt asked for "a single TypeScript module of at least 400 lines in ONE
  typescript code block" (LRU cache + typed event emitter + doc comments, no
  prose); the model consistently produced **860–1,050-line** single blocks
  (25–33 KB code, 1.2–1.4 MB SSE stream incl. reasoning deltas), i.e. ~2.4×
  the plan's 400-line fixture — same workload for every config.

## 2. Build matrix

| Config | Flags | Commit | Port | Worktree |
| --- | --- | --- | --- | --- |
| A (baseline) | both unset (legacy) | `0aa5f7ff` | 3011¹ | `scratchpad/builds/wtA` |
| B (throttle) | `NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE=50` | `0aa5f7ff` | 3002 | `wtB` |
| C (full) | throttle=50 + `NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE=throttled-highlight` | `0aa5f7ff` | 3003 | `wtC` |
| D (pre-PR control) | instrumentation only | `7228afaa` | 3014 | `wtD` |

¹ Port 3001 was already occupied by a pre-existing user process (left
untouched). Flag inlining was verified in the built chunks (A retains the
unset env reference; B/C carry the inlined literals; C has the extra
inlined `throttled-highlight` default-argument occurrence). D was built
mid-session to attribute the reload-freeze anomaly (section 6).

## 3. Part 1 — correctness and quality

- `bun run typecheck`, `bun run lint`, `bun run test`: **all pass** (188
  files, 1,621 passed / 1 skipped).
- **Deterministic notification matrix** (`bunx vitest run
  app/components/chat/use-chat-core.ai-sdk-seam.test.tsx
  --disable-console-intercept`): the `[pr2-throttle-selection]` line matches
  the selection doc **cell for cell** — 100 cps: 36/15/11/8 notifications at
  0/32/50/100 ms (−69% at 50 ms), first-text 10 ms in every cell; 30 cps:
  36/36/25/15 at 33 ms; 10 cps: 36 at every value, 100 ms.
- `bun run bench:chat` vs the PR 0a baseline doc: splitter settled ~10.6 ms
  (baseline ~9.8), re-split 41 states ~201 ms (~193), React render settled
  ~37.7 ms (~35), Shiki settled 400-line **16.6 ms mean** (~15.5; PR 3 doc
  claims 16.0 median/17.4 max), re-highlight 45 states ~389 ms (~357). All
  within run noise → **no regression from the block-record change**.
- **Diff review vs plan §4 / out-of-scope ledgers — clean.** Specifics:
  - PR 2: flag resolved once per mount via a `useState` initializer (cannot
    change mid-subscription); confined to `use-chat-core.ts`; fail-safe
    parser (malformed/negative/huge values → 0, cap 1000 ms); trailing
    update, Stop, error, approval/continuation, status-immediacy, and
    unmount-during-trailing all pinned by the seam tests against the real
    `@ai-sdk/react@4.0.23`.
  - PR 3: descope ledger respected — no `lib/markdown/fence-state.ts`, no
    derivation cache, no incremental parsing (`parseMarkdownIntoBlocks`
    still full-parses; only the return shape changed to records). Legacy
    mode is byte-for-byte the pre-PR effect and fallback JSX.
    `plain-while-growing`'s display rule requires exact
    (code, language, theme) match, so stale highlighted HTML can never show
    non-current code; the plain path is React-escaped text (`<script>`
    inert — covered by test); copy uses the raw `code` prop; timers are
    cleared on unmount and every input change; out-of-order highlighter
    completions are invalidated by generation token. `MessageAssistant`
    passes a single merged string per assistant row, so the
    terminal-block-only stability rule is sound.
  - No test gaps worth padding were found; the suite covers the plan's
    listed automated tests (lean-suite preference respected).
  - Minor, non-blocking notes: (1) in `throttled-highlight` a theme switch
    mid-growth shows the old-theme highlight for ≤300 ms (inherent to the
    throttle window, allowed); (2) block identity is index-based
    (`block-${index}`) with a comment asserting streamed Markdown only
    appends — boundary-merging edge cases degrade to an extra re-render,
    not incorrect content.

## 4. Part 2 — code-heavy stream cells (the headline)

Same prompt/model everywhere; per-run output size recorded because the model
overshoots the 400-line request. "LT" = long tasks (≥50 ms) during the
stream, from the injected observer.

| Cell | Tab | Outcome | Stream | LT count / total / max | Typing during stream (keydown→frame) |
| --- | --- | --- | --- | --- | --- |
| A1 | hidden | **Renderer hard-frozen** from ~40 s after send until force-navigated away at **~18 min**. CDP input, JS eval, and screenshots all timed out; Stop unreachable; no metrics extractable. | n/a | n/a | impossible — input never dispatched |
| A2 | visible | Froze within ~65 s; **renderer crashed** ("Target crashed" / Aw-Snap, i.e. OOM-class) minutes later. After reload the chat rehydrated fully: 883-line highlighted block, settled. | n/a | n/a | impossible |
| B1 *(hidden)* | hidden | Completed ~174 s; 947-line block; 1.15 MB | 2,582 chunks | 376 / 55.4 s / 2,591 ms | all 61 chars landed (latency probe unavailable while hidden) |
| B2 | visible | Completed ~93 s; 1,050-line block; 1.44 MB | 3,108 chunks | **232 / 23.3 s / 360 ms** | med 10 ms, p95 20 ms, max 20 ms (n=30) |
| C1 | visible | Completed ~100 s; 1,047-line block; 1.32 MB | 4,235 chunks | **77 / 6.9 s / 235 ms**² | med 8 ms, p95 16 ms, max 17 ms (n=30) |
| C2 | visible | Completed ~72 s; 860-line block; 1.21 MB | 3,987 chunks | **38 / 3.2 s / 113 ms** | med 9 ms, p95 16 ms (n=30) |
| C3 *(synthetic-load ~75%)* | visible | Completed ~94 s; 397-line block; 510 KB | 1,571 chunks | **5 / 0.62 s / 227 ms** | med 8–9 ms, p95 16 ms (n=50, two probes) |

² C1's totals include a mid-stream copy click and post-settle theme-switch
experiments; C2 is the clean run.

Supporting timings: first `/api/chat` response chunk arrived 428–440 ms
after send in every measured config; first visible markdown text 12.2–17.2 s
(dominated by GPT-5 Mini's server-side reasoning phase, identical across
configs — no render-path delay attributable to the throttle was observable
above that noise, consistent with the harness's exact result that first-text
delay equals the 0 ms baseline).

Texture notes: A is unusable (frozen). B renders highlighted growth at the
throttled cadence and stays interactive, but late-stream commits visibly
chug as the block passes ~700 lines (long tasks up to 360 ms). C looks
ChatGPT-like: continuous highlighted growth, no visible pop or stall,
scrolling and typing stay fluid the whole way; under synthetic contention it
remains smooth. B-vs-C texture difference is small to the eye; the long-task
distributions (23.3 s vs 3.2–6.9 s blocked time) are not.

Interpretation of B1 vs B2: hidden-tab timer batching inflates B1; use B2
for comparisons. Even so, B's legacy per-commit full-block highlight at
50 ms cadence accounts for B2's 232 long tasks; C replaces that with a
≤1-per-300 ms highlight and drops blocked time another ~3–7×.

## 5. Functional parity checks

- **Copy during growth (C1, mid-stream):** clipboard intercept captured 29,024
  chars of raw code (starts `/** In-memory uti…`, no `<span`/markup). ✔
- **Theme switch after settle (C1):** `shiki github-light` → `github-dark`
  re-highlight on toggling the theme; restored to System afterwards. ✔
- **Stop:** on C, Stop during the pre-output thinking phase landed instantly
  (run ended, empty aborted turn kept as a visible stub row). On A
  (flags off) the same stop-then-reload flow settled to "Generation stopped.
  Partial response preserved." ✔ — with the caveat in section 6. In legacy
  mode during a code stream, Stop is **unreachable** (A1/A2 freeze), matching
  the PR 3 doc's dev-build observation.
- **Reload during/after generation:** A2's chat rehydrated completely after a
  renderer *crash* (durable run finished server-side; 883-line block
  restored) — invariant §4.1.1 held under the harshest client failure. ✔
- **Not covered this session:** a dedicated ~10 KB mixed-markdown scenario
  cell (tables/lists/links, no code) and an approval/tool-heavy stream. The
  runs above each streamed multi-KB reasoning/markdown phases with clean
  input latency on B/C, and the splitter numbers are pinned by `bench:chat`,
  but the scenario-(b) matrix cell as specified was skipped for time. Noted
  as a gap, not a verdict change.

## 6. Anomaly (blocking): reload during the post-Stop window can freeze the tab

> **Resolved 2026-07-23 — see `2026-07-23-section6-freeze-rootcause.md`.**
> The throttle (PR 2) is exonerated: a deterministic harness (real
> `useChatCore` + `@ai-sdk/react` + reconciliation) shows throttle=50 produces
> *fewer* React commits than flags-off (49 vs 76) for the same storm and both
> go fully quiet afterward — no notification/render loop. The freeze is
> main-thread saturation from re-rendering/re-highlighting a large, growing
> code block on every post-Stop snapshot; it reproduces with flags **off**
> (the flags-off build OOM-crashed on the big-block thread). The §6
> attribution below was the confound it flagged. Net effect on the
> recommendation: the hold on `NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE` is lifted,
> and PR 3's `throttled-highlight` (the direct mitigation) should ship with it.

Sequence that produced it: on chat `jh75tahr…` (config C; one settled
947-line turn + a second turn stopped before any output, server log
`durable_finish_handoff_missed` for that run), reloading the chat within
~10 minutes of the Stop hard-froze the renderer (no JS eval, no input) —
**twice on C** (onset ~15 s and ~60 s after an initially fine load) and
**once on B** when the same chat was opened there (~60 s after load). After
the run state settled, the same chat loads fine on every config.

Attribution evidence (each observed ≥150 s under the same probe protocol):

| Build | Same-recipe repro (stop during thinking → immediate reload) | Result |
| --- | --- | --- |
| D pre-PR `7228afaa` | own chat, same `durable_finish_handoff_missed` marker | no freeze (191 s) |
| A post-PR, flags off | own chat | no freeze (172 s), correct aborted stub |
| B/C post-PR, flags on | original chat (in-window) | froze (3 events total) |

Honest confounds: the B/C freezes were all on one chat whose first turn was
a ~950-line settled block, while the A/D repro chats contained only the
stopped turn; and the B observation is n=1. The evidence is therefore
*strongly suggestive* that the throttle-enabled builds interact badly with
post-Stop durable reconciliation (e.g. a throttled-notification /
reconciliation loop), but the "big settled turn + in-window reload +
flags off" cell was not run. This trips the spirit of §9.3 (a visible-state
hang is worse than a stale part) and §9.4 (long-task blow-up): **do not
enable `NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE` in production until this is
root-caused or shown pre-existing.** Repro recipe: send the code prompt,
click Stop while "Thinking", reload the chat immediately and keep it open
≥3 min, on a chat that already contains a large settled code turn.

## 7. Verdicts on the existing measurement docs

`2026-07-23-pr2-throttle-selection.md`:

- 50 ms selection, −69% notifications @100 cps, 0% @10 cps — **confirmed**
  (matrix reproduced exactly, counts identical).
- First-visible-text unaffected at every value — **confirmed** (harness
  exact; browser first-text differences were provider-dominated, none
  attributable to the throttle).
- No lost final/approval/tool/error/terminal updates — **confirmed** in the
  suite and in live Stop/reload flows, with the section 6 anomaly recorded
  as a separate, possibly-related open issue for the flag-on reload path.

`2026-07-23-pr3-streaming-code-decision.md`:

- 16 ms per settled 400-line highlight — **confirmed** (16.6 ms mean here).
- 8 vs 40 highlights on a 40-delta stream, never per-delta — **confirmed**
  (deterministic test passes; live long-task profile consistent).
- Throttled-highlight recommended over plain-while-growing — **confirmed
  and strengthened**: C beat B by ~3–7× on blocked main-thread time with
  ChatGPT-like texture, and the doc's 4×-slowdown caveat (~64 ms highlight)
  did **not** materialize into input-delay harm under ~75% synthetic
  contention (typing p95 16 ms, max long task 227 ms) — proxy method noted.
- "Legacy froze the dev build for tens of seconds" — **confirmed and
  understated**: the *production* baseline froze 17+ minutes (hidden tab)
  and crashed the tab outright (visible) on the ~950-line stream.

## 8. Verdict and recommendation

**TANGIBLE: yes, decisively.** On the code-heavy scenario the baseline is
catastrophically broken (freeze/crash, Stop unreachable, 2/2 runs); B
restores full interactivity (typing p95 20 ms); C additionally removes
~3–7× of remaining main-thread blocking and preserves the
highlight-while-streaming look. First-visible-text is not degraded. All
§9.3 correctness checks pass on the runs that settled (copy, theme, Stop
stubs, crash-reload rehydration) — except the section 6 anomaly.

Recommended sequence:

1. **Hold production enablement briefly** to root-cause the post-Stop reload
   freeze (section 6 recipe). If it reproduces with flags off or pre-PR, it
   is a pre-existing bug and stops blocking the flags; if it is
   throttle-linked, fix before enabling.
2. Then enable **both** `NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE=50` and
   `NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE=throttled-highlight` per §9.2 —
   the measured case is overwhelming, and shipping neither leaves a
   production tab-crash pathology (A2) in the current default path.
3. `0` / `legacy` remain valid instant rollbacks (build-time, redeploy).

## 9. Out-of-scope observations (not fixed here)

1. The section 6 freeze — **root-caused 2026-07-23**
   (`2026-07-23-section6-freeze-rootcause.md`): not throttle-related;
   large-block re-render/re-highlight cost during the post-Stop snapshot
   window, reproducible flags-off. Flag hold lifted; ship PR 3
   `throttled-highlight` alongside. Remaining flag-agnostic hardening
   (bounded reconcile, faster settlement of handoff-missed runs) tracked there.
2. Every production-server request logs `Error fetching user key from
   Convex: Error: Unsupported or malformed ciphertext` (twice per request);
   generation still succeeds via the platform/env key. BYOK decrypt is
   broken for this account/deployment combination.
3. `durable_finish_handoff_missed` (+ `durable_worker_authority_revoked`,
   `durable_terminal_write_rejected_settled`) is emitted for stop-before-
   output runs on pre-PR and post-PR builds alike.
4. The composer submit button keeps `aria-label="Send message"` while
   visually acting as Stop during streaming (a11y mislabel).
5. With text present in the composer during a live stream, the button
   becomes Send and there is no visible Stop control until the composer is
   cleared.
6. GPT-5 Mini emits 2–2.6× the requested line count; worth pinning fixtures
   to a deterministic local stream for future browser comparisons
   (PR 0a fixtures cover the unit/bench layer only).

## 10. Artifacts and cleanup

- Servers on 3011/3002/3003/3014 stopped; the user's dev server (:3000) and
  the pre-existing :3001 process were never touched.
- Build worktrees retained (noted, not deleted):
  `/private/tmp/claude-501/-Users-andresgonzalez-Github-Projects-not-a-wrapper/a03458d2-4739-46f3-a36a-660351e2e2f5/scratchpad/builds/wt{A,B,C,D}`
  (detached worktrees; remove later with `git worktree remove --force <path>`).
- Test chats left in the account (titled `PERF RUN …`): A1, A2, B1, B2, C1,
  C2, C3 STRESS (+ its stopped second turn), D-STOP REPRO, A-STOP REPRO.
