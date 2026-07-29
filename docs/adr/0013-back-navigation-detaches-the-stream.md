# 13. Back navigation detaches the client stream instead of aborting the run

- Status: accepted
- Date: 2026-07-18
- Related: ADR-0008 (no stream-resume read surface — intact), ADR-0011
  (durable turn settlement — the server half this relies on; its deferred
  lease/reaper is inherited here), ADR-0012 (atomic first-turn creation —
  owns the shallow-pushState flow whose Back edge this governs)

## Context

The first-turn flow navigates `/` (or `/p/[projectId]`) → `/c/<chatId>` via
shallow `pushState`, so Chat stays mounted and only `chatId` changes in
place. The mounted chat-id transition effect historically called `stop()`,
so browser Back to the onboarding surface mid-generation ABORTED the durable
run — while link navigation (which remounts Chat) deliberately leaves the
run streaming to server-side settlement. The asymmetry was documented in
code, not chosen: Back is a navigation gesture, the Stop button is the
cancellation gesture, and ADR-0011 already made settlement server-owned.

A naive "just don't stop" fails: the useChat hook stays mounted, so
streaming deltas keep appending to the cleared array and break the
onboarding gate (`showOnboarding` requires `messages.length === 0`). A
first cut (same-day) recreated the SDK instance by changing `useChat`'s
`id` option, but review found that all instances created by one hook share
one latest-closure callback set — a detached finish then resolved identity
from *current navigation state* (`chatId`/`previousChatIdStore`/stored guest
chat id), which could cache a detached guest stream's assistant message into
a *different* chat, consume another chat's pending edit, and misattribute
`finishReason` and error toasts.

## Decision

Mounted chat-id transitions away from a chat **detach** — the in-place
equivalent of the link-nav remount — via an ownership unit, the
**Detachable stream binding** (`ChatStreamBinding` in `use-chat-core.ts`):

1. **The hook owns its Chat instances** (`useChat({ chat })`, not `id`).
   Each binding constructs its own AI SDK `Chat` with per-binding callbacks:
   business logic routes through a latest-closure ref, identity comes from
   the binding.
2. **Origin is frozen, not recovered.** `ownerChatId` tracks the mounted
   chat only while the binding is attached; replacement happens in the same
   render that changes `chatId` (adjust-during-render, so no frame of the
   old thread leaks into onboarding), and the commit-side effect marks the
   old binding detached. A detached finish routes to `ownerChatId`: guest/
   local chats cache the (possibly partial) assistant message and their own
   pending edit into the origin chat; durable chats are a client no-op
   (persistence is server-owned per ADR-0011). Mounted-surface UI state —
   `lastFinishReason`, error toasts, createdAt stamping in the live array —
   is deliberately skipped for detached finishes.
3. **null → chatId never detaches**: first-turn adoption keeps the binding
   so the optimistic user row and the already-started stream carry into the
   durable route (ADR-0012's flow).
4. **Bounded orphans.** A detached binding gets a watchdog with the same
   hard time budget as the attached stuck-stream guard (120 s): the system
   can always stop a detached stream even though the user cannot, bounding
   token spend and the stale-spinner window when settlement degrades
   (ADR-0011's degraded receipt leaves the run to the supersede sweep). A
   detached binding also refuses `sendAutomaticallyWhen`, so an orphan never
   auto-continues a tool-approval turn.
5. **Stop semantics unchanged**: the Composer's Stop binds to the current
   (attached) binding and still aborts via Stop → `req.signal` → `onAbort`.

## Consequences

- Back/Forward and link navigation now mean the same thing during a
  generation: leave the view, keep the work. The sidebar's backend
  projection (`live_run_status`) keeps the generating ring after the local
  override clears, then shows the unread dot on settlement.
- A generation the user navigated away from continues to consume provider
  tokens until it finishes or the watchdog fires — the accepted cost of
  "Back is not Stop", bounded by the 120 s budget and `maxDuration`.
- The SDK-facing contract this relies on is deliberately narrow: a replaced
  `Chat` instance keeps consuming its stream (the same property the
  deliberate link-nav remount behavior has relied on since 2026-07-03), and
  `useChat({ chat })` re-subscribes when the passed instance changes. The
  latest-closure `id`-recreation behavior is NOT relied on anymore.
- Render-phase construction is side-effect-free and detach side effects are
  commit-side, so a discarded concurrent render leaves only an unreferenced
  instance; useChat's own render-time internal ref reassignment self-heals
  on the next committed render.

## Amendment (2026-07-28): return re-adopts a still-live detached binding

Detach alone left a user-visible cost on the return path: navigating back
to a generating chat mounted a *fresh* binding (status `ready`), so the
surface rendered the Convex durability plane at its 750 ms snapshot cadence
(~350-char slabs) while the detached binding kept the word-granular stream
nobody rendered (measured in
`docs/measurements/2026-07-28-streaming-failures-investigation.md`, issue 2).

A mounted transition **to** a chat whose detached binding is still streaming
now **re-adopts** that binding — the inverse of detach, in the same
layout-phase commit: lifecycle back to attached (owner identity re-frozen to
the origin, which is the destination), watchdog cleared (the attached
stuck-stream guard owns the budget again), `sendAutomaticallyWhen` re-armed
by construction (it reads the lifecycle at dispatch time). The surface
resumes the original word-cadence local array — strictly fresher than the
snapshot path — and Stop regains a live local target. The owner keeps a
chatId → detached-binding registry; liveness comes from the SDK chat's
`status` (not the lifecycle's `finished` flag, which latches after a
binding's first completed turn), and entries are removed on re-adoption or
in finish routing — the SDK invokes `onFinish` in a `finally`, so a dead
binding cannot linger. A binding that finished while away fails the
liveness check and falls through to the fresh-binding + projection path,
unchanged.

Convex stays the recovery plane for reload / second tab / other device, and
the 750 ms snapshot cadence is untouched (per ADR-0016, paint cadence never
couples to the durability plane). One projection consequence: entry
hydration can now run mid-stream, so the entry-time selected-path pass
defers a *divergent* (wholesale branch-swap) projection to settle — the
monotonic identity-matched reconcile remains safe mid-stream.

## Deferred (not rejected)

- **Durable run-scoped Stop**: re-entering a chat whose run streams in the
  background shows the projected status but offers no Stop (the same gap
  the link-nav remount has always had). A client-initiated abort would
  apply the lifecycle abort verdict directly (first-terminal-wins absorbs
  the racing stream writes). Belongs with ADR-0011's lease/reaper phase.
  The 2026-07-28 amendment narrows this: same-tab return now re-adopts the
  live binding, so local Stop works again there; the gap remains for
  re-entry after a remount or from another tab.
- **Lease/heartbeat + cron reaper** (ADR-0011): the backstop for a stale
  `live_run_status` after worker death or platform cutoff; the client
  watchdog narrows but does not close that window.
