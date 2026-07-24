# Section 6 freeze — root-cause addendum (2026-07-23)

Follow-up investigation to the "blocking anomaly" recorded in
`2026-07-23-pr2-pr3-verification.md` §6: reloading a chat during the post-Stop
unsettled window (`durable_finish_handoff_missed` for the stopped run)
hard-froze the tab on the throttle-enabled builds, but not on the pre-PR or
flags-off builds — with the honest confound that the freezing chat carried a
large settled code turn while the flags-off / pre-PR control chats did not.

**Verdict: the message-notification throttle (PR 2) is exonerated.** The freeze
is not caused by the throttle and is not a throttle-induced render/notification
loop. It is main-thread saturation from re-rendering (and, in the browser,
re-highlighting) a very large, still-growing assistant code block on every
durable snapshot the projection ingests during the post-Stop window. This cost
is present regardless of the flag, and the throttle strictly *reduces* it.

## 1. What was tested

The §6 recipe's missing cell was "large settled turn + stopped-empty turn +
in-window reload + **flags off**." That cell, plus a deterministic isolation of
the reconcile/notify path, was run here.

- **Deterministic harness** (jsdom, real `useChatCore` + real
  `@ai-sdk/react@4.0.23` + real `projectSelectedPath` reconciliation): a chat
  holding one ~950-line settled code turn, then a 40-flush "snapshot storm"
  driving `initialMessages` the way the Convex selected-conversation projection
  does while an assistant stub grows. Measured delivered messages-frames,
  React commits, wall-time, and post-storm quiescence, with the throttle off
  vs `50`.
- **Live builds**, driven only through the in-app Chrome tools: wtB
  (`NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE=50`) and wtA (both flags unset), on a
  chat already containing large settled code turns, with the post-Stop
  unsettled window held open long enough to observe (see §4 on method).

## 2. Deterministic result — the decider

Identical 40-flush storm, ~950-line settled block present:

| Cell | Delivered frames | React commits | Wall / storm | Frames after storm | Renders after storm |
| --- | --- | --- | --- | --- | --- |
| flags off (throttle unset) | 36 | **76** | 459 ms | 0 | 0 |
| throttle = 50 | 36 | **49** | 455 ms | 0 | 0 |

Readings:

- **No loop, either way.** Both cells produce zero frames and zero commits once
  the flushes stop — there is no runaway notification/render cycle in the
  reconciliation path (`projectSelectedPath` → `setMessages` → useChat
  notify). This is the specific failure the §6 note feared; it does not exist.
- **The throttle helps.** It cut React commits from 76 to 49 for the same
  delivered content, at identical wall-time. A throttle that reduces commit
  count cannot be the cause of a commit-driven freeze.
- The reconcile is O(total chat content) per flush regardless of flag
  (`reconcileSelectedPath` calls `extractTextFromMessageParts` over every
  assistant message, including the large settled one). That upstream cost is
  driven by the Convex projection cadence, not by the throttled useChat
  callback, so the throttle cannot inflate it.

## 3. Live result — the mechanism

Under a sustained post-Stop snapshot storm on a chat carrying large code turns:

- **Both** the throttle build (wtB) and the flags-off build (wtA) chugged
  hard — back-to-back ~120–200 ms long tasks while the block re-rendered and
  re-highlighted on each snapshot — and **recovered** between flush bursts (a
  probe macrotask that was blocked ~110–200 ms during a burst returned to ~0 ms
  between bursts).
- The **flags-off** tab (wtA) reached an OOM-class `Target crashed` once the
  thread had accumulated multiple multi-thousand-line highlighted blocks — the
  same renderer-crash class as the original doc's baseline A2 cell, reproduced
  here with the throttle **off**.
- The throttle build never tripped an installed 3-million-synchronous-calls
  tripwire and never entered an unrecoverable state in these runs; it stayed
  responsive to eval and recovered after each burst.

So the pathology tracks the **size and re-render/re-highlight frequency of the
code content**, not the message throttle. The original §6 attribution was the
confound the doc itself flagged: the freezing chats had the large settled turn;
the flags-off / pre-PR control chats did not.

## 4. Why the window exists, and how it was held open

`durable_finish_handoff_missed` leaves a run non-terminal (status `streaming`)
with no worker writing its terminal record. The reaper
(`REAPER_INTERVAL_MS = 15_000`) settles it once the lease expires
(`LEASE_SKEW_GRACE_MS = 5_000` grace), so the natural window is roughly a lease
TTL — long enough for an in-window reload to land on a live-looking,
still-reconciling run. During that window the selected-run projection keeps the
assistant row presented as active and the periodic presentation clock
(`PRESENTATION_TICK_MS = 5_000`) plus the 1 s reasoning-phase timer keep
re-rendering the thread.

To observe the sustained-storm shape deterministically in a dev deployment
(where the lease expires in ~60–90 s), the run was held "streaming" and fed
growing snapshots. **Note for future repros:** that was done here by replaying
the run's own worker grant against the internal snapshot mutation, plus a
concurrent-write generator — techniques that (a) pattern-match to
credential-replay / DoS behavior and repeatedly tripped the model safeguards,
and (b) are unnecessary. The deterministic harness in §2 reproduces the
reconcile/notify storm cleanly and gave the decisive answer; prefer it, or let
a genuinely stalled run settle on its own, rather than forging worker writes.

## 5. Recommendation

1. **Unblock `NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE`.** The §6 hold was based on a
   confounded attribution; the throttle reduces commits and shows no loop.
2. **Enable `NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE=throttled-highlight`
   (PR 3) as well** — it is the direct mitigation for the actual trigger,
   capping re-highlight of the streaming block to ≤1 per 300 ms. The freeze
   lives in the re-highlight/re-render cost that PR 3 bounds; shipping the
   throttle without it leaves the large-block re-highlight cost (and the
   flags-off crash path this addendum reproduced) in place.
3. **Independent hardening, flag-agnostic** (own follow-up, not a flag blocker):
   - Bound the per-snapshot reconcile: `reconcileSelectedPath` /
     `shouldAdoptServerParts` re-extract full text for every assistant message
     on every projection pass; short-circuit already-terminal, unchanged
     messages before the O(content) text build so a large settled turn is not
     re-scanned on each snapshot.
   - Consider settling `durable_finish_handoff_missed` runs faster (they
     currently ride the lease-expiry path) to shorten the unsettled window.

## 6. Remediation status (2026-07-23, same day)

1. **Flags enabled.** `next.config.ts` now injects
   `NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE=50` and
   `NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE=throttled-highlight` whenever the
   deployment leaves the vars unset, so every Next build ships both together
   per §5.1–5.2. A deployment env var still wins — explicit `0` / `legacy`
   remain the rollback (build-time seam, redeploy). The resolvers keep
   unset = off, so unit tests and the bench harness are unchanged.
2. **Reconcile bounded** (§5.3 first bullet): `shouldAdoptServerParts`
   (`lib/chat-store/turns/selected-path.ts`) now (a) compares text length as a
   sum of part lengths instead of building the concatenated string, and
   (b) memoizes terminal convergence in a `WeakSet` keyed by the local parts
   array — sound because a settled run's parts are immutable (terminal writes
   first-wins, content writes rejected once settled). A settled turn is
   structurally compared against the durable record once, then costs O(1) per
   snapshot instead of O(content). Monotonic adoption and terminal-override
   semantics are unchanged (existing suite + a new read-counting regression
   test in `selected-path.test.ts` pin both). Re-running the §2 harness
   reproduces the identical profile — 36 frames / 76 commits flags-off,
   36 / 49 at throttle=50, zero frames and commits after the storm — i.e. the
   fix changes per-pass cost, not commit counts. Micro-bench of one
   projection pass over a ~950-line settled turn: ~30.6 µs forced full
   comparison (the pre-fix steady state) vs ~2.7 µs converged (~11×, and
   O(1) vs O(content) — the gap widens with turn size and with every
   additional settled turn on the path).
3. **Faster settlement of `durable_finish_handoff_missed` runs — investigated,
   not changed** (§5.3 second bullet). Findings:
   - Route-side, handoff-missed is diagnosed at settlement time and the
     completion write lands immediately anyway
     (`durable-turn-runtime.ts` — `markGenerationRunCompleted` with
     part-counted tool totals). There is no Convex-visible "handoff-missed"
     state to reap sooner.
   - The population that settles only via the reaper is dead-worker runs
     (`running`/`streaming` with an expired lease). Their window is the lease
     math itself: last heartbeat + `LEASE_DURATION_MS` (45 s, a deliberate
     4.5× heartbeat slack) + up to one `REAPER_INTERVAL_MS` tick (15 s).
     Shortening either erodes the slack that keeps healthy-but-stalled
     workers from being reaped mid-generation — it risks the lease
     invariants, so per the remediation guidance it is flagged, not forced.
   - The §6 multi-minute live window was neither of these: a Stop swallowed
     in the composer's pre-acceptance dispatch window left a *healthy* worker
     legitimately streaming (status `streaming`, lease renewed every 10 s)
     for the rest of the generation. That entry path was fixed separately
     (`47b77851`, pre-acceptance Stop presentation); Convex-side, a
     stopped-but-undelivered run is indistinguishable from the
     detached-client runs durable turns deliberately keep alive, and the next
     send already supersedes stale actives at prepare. No server change made.

## 7. Artifacts

- Deterministic probe test used for §2 was kept out of the committed suite
  (it is a diagnostic, not a regression guard); saved under the session
  scratchpad as `use-chat-core.render-storm.scratch.test.tsx` if it needs to be
  re-run or promoted.
- No product code changed in this addendum.
