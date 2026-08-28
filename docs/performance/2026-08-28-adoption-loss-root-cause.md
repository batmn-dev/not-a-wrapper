# Live-stream adoption loss — root cause and fix

Date: 2026-08-28 · Symptom: ~7% of durable first sends silently degraded to
750 ms snapshot rendering (visibly chunky streaming) with no error; the turn
completed and settled correctly. Tracked as `liveStreamNotAdoptedRuns` since
the B5 measurement work.

## Method

`benchmarks/chat-performance/browser/adoption-loss-repro.ts`: repeats the
authenticated first-send flow and captures, per run, the full `chat-perf:*`
mark timeline (including the ADR-0013 binding-lifecycle gauges), document
`load` events, RSC fetches, console errors, and — decisively — a
pre-app-load History API patch recording every pushState/replaceState/
popstate with a stack trace. Reproduction: 5 losses in 70 runs (~7%).

## What the forensics ruled out

- **Not a document navigation.** Zero `load` events; the User Timing marks
  survive the whole run.
- **Not a dead stream.** `client_first_stream_bytes` and
  `client_first_text_delta_received` fire ~700 ms in — the accepted fetch
  keeps streaming; nothing renders it.
- **Not the ADR-0013 adoption logic.** The gauges show adoption SUCCEEDING
  in every loss: `created [unowned]` → `adopted [durable]`.
- **Not the history choreography.** The op sequence is byte-identical in
  adopted and lost runs: Next's initial replaceState, the app's shallow
  `pushState → /c/<chatId>` (from `navigateToChat` via `ensureChatExists`),
  then two Next-internal replaceStates to the same URL.

## Root cause

The smoking gun is a THIRD binding gauge in every loss, 30–90 ms after the
successful adoption: `created [durable]` with attachedCount 2 and **no
detach** — a fresh `useDetachableChatStream` owner, i.e. a **Chat component
remount**. The remounted instance's per-instance owner cannot see the live
binding (that map died with the old instance), so the surface renders from
the Convex snapshot subscription while the orphaned SDK `Chat` object
consumes the stream into nothing. Silent by construction: nothing errors.

Why the remount: both `(chat)` page segments — `(chat)/page.tsx` at `/` and
`(chat)/c/[chatId]/page.tsx` — rendered their own `<Chat/>`. The first-turn
shallow-pushState handoff (ADR-0012/0013 design: "First-turn navigation
deliberately preserves the mounted chat surface") is a bet that the Next
router never actually commits the `/c/[chatId]` segment mid-stream. Usually
it doesn't (or the commit reconciles the identical `<Chat/>` element in
place). Intermittently it commits a real segment swap just after the push —
the page subtree is replaced, and a page-owned Chat is torn down with it.

## Fix (route structure, not stream machinery)

`<Chat/>` moved into the persistent `(chat)/layout.tsx` — the layout Next
explicitly preserves across `/` ↔ `/c/[chatId]` navigations (already
load-bearing for the sidebar scroll root). The page segments keep only their
server duties (`/c` keeps its WorkOS auth redirect) and render null; Chat
reads route identity from `ChatSessionProvider`, so it needs nothing from
the segments. A segment commit now reconciles AROUND the surface and cannot
unmount a live stream, whatever the router's timing.

A layout test pins the ownership (`layout.test.tsx`: "owns the Chat surface
so route-segment swaps cannot remount it").

## Verification

- Reproducer: **0 losses in 60 runs** post-fix vs 5/70 before
  (P(0/60 | 7%) ≈ 1.3%).
- Full durable suite (5 scenarios × 5 runs, including second-tab, reload,
  stop, paused): all correctness green, **0 adoption losses**, all latency
  metrics within baseline noise.
- Guest smoke suite green; full unit suite (2,574) green.
- The harness now FAILS any scenario with `liveStreamNotAdoptedRuns > 0`
  (the TODO's regression gate; expected 0 permanently).

## Second half — remounts made survivable (project variant, same day)

A project-originated first send (`/p/[projectId]` → `/c/<chatId>`) crosses a
LAYOUT boundary into `(chat)`, so a mid-stream router commit there remounts
Chat no matter which segment owns the surface. Fixed at the stream layer by
generalizing ADR-0013's nav-return re-adoption to EVERY remount:

- the detachable-stream owner is **module-scoped** (one shared
  `detachedByOrigin` registry instead of one per Chat instance),
- Chat's unmount cleanup **detaches** its binding into that registry
  (previously the binding leaked as attached — the `attachedCount 2` gauge
  signature),
- a mounting Chat attempts **readopt for its chatId** once per mount, and an
  `ensureAttached` heal covers StrictMode's mount→cleanup→mount handing the
  same binding back.

Verified with the reproducer's `MODE=project` (creates a real project via
the UI, sends from `/p/<projectId>`): **40/40 adopted, 0 lost** — and runs
10/33/34 show `bindingsCreated=2`: the remount DID occur (~7.5%, matching
the original loss rate) and the second instance re-adopted the live stream.
The fix does not prevent the remount; it makes it harmless. Full durable
suite (adoption gate armed) and the 2,574-test unit suite green.

Also observed once in early reproduction (run 21 of the first batch): a loss
run whose final URL was the PREVIOUS run's chat — consistent with a stale
router commit landing late. The layout-owned surface makes that harmless to
the stream as well (the URL/system state converges via the session provider),
but it hints the router-commit trigger involves stale prefetch/cache entries.
