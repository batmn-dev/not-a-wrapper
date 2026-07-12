# Prompt: Streaming/Persistence Concurrency Audit & Fix

> Copy everything below this line into a fresh agent/engineer session, run from the repo root.

---

## Mission

You are a senior software engineer performing a **deep concurrency audit of the chat streaming and persistence subsystem** of this app (Next.js App Router + AI SDK v7 + Convex). Your job has two phases:

1. **Investigate**: build a complete, evidence-backed model of every concurrent interleaving in the generation lifecycle — send, stream, snapshot persistence, stop/abort, error, navigation, edit, regenerate, branch-switch, and the zombie-run sweep — and identify where the current design is fragile, racy, or merely patched.
2. **Fix**: resolve the known open bug (below) and any confirmed defects you find. When choosing how to fix, **lean toward composable, mature, industry-standard designs — including an architectural refactor if one is genuinely warranted**. This app is pre-launch with **no users and a disposable dev database** (see `AGENTS.md`, "The Database Is Disposable"), so schema changes, protocol changes, and structural refactors are cheap right now and expensive later. Do not refactor for its own sake; do refactor when the honest answer to "what would a mature system do here?" is structurally different from what exists.

## The known open bug (primary target)

**Edit version-guard false rejection after a rapid multi-branch session.** Observed 2026-06-20 during live verification: after a rapid automated sequence (regenerate → branch-switch → send → regenerate), an in-session edit was rejected with `Chat changed since edit started` — the `selectedMessages.length !== args.edit.expectedChatVersion` guard in `applyEditIntentForGeneration` (`convex/chatRuntime.ts`, around line 717 at the time).

Facts established then:

- The client computes `expectedChatVersion` as `sanitizeVisibleChatMessages(messages).length` over the live `useChat` array; the server counts its selected path. The two drifted; after a fresh page reload the identical edit succeeded — so the server state was fine and the **client's projection lagged or retained a stale extra**.
- A sibling bug (regenerate `createdAt` drift) was fixed by making the reconcile adopt the server `createdAt`. This **count** drift was explicitly not fixed.
- The suspected root: at idle, the client array should equal the server selected path exactly, **except** during the persistence lag of a just-sent turn. Distinguishing "legit just-sent extra" from "stale leftover" currently has no signal — the projection seam is `projectSelectedPath` in `lib/chat-store/turns/selected-path.ts`.
- A related **self-healing** edge is documented and accepted: an edit/regen racing the zombie-run sweep can be rejected once because `closeSupersededGenerationsForChat` materializes a newly-visible stub after the client counted; the live query re-syncs and retry succeeds. Your fix should ideally subsume this edge too, but at minimum must not break its self-healing.

Treat the count-based version guard itself with suspicion: comparing two independently-computed lengths is a proxy for "the client saw the state it is editing." Ask whether a mature design would use a real version/timestamp token (e.g., a server-issued chat revision, per-message revision, or the projection carrying the server's own count) instead of two sides re-deriving a number and hoping they agree. That question is in scope.

## System map (verified facts — start here, but re-verify against current code)

These were verified live in early July 2026; the code may have moved. Confirm each before relying on it.

**Server runtime**: `app/api/chat/route.ts` → `chat-turn-runtime.ts` →
`durable-turn-runtime.ts` (+ `outcome-sinks.ts`). Client turn orchestration lives
under `lib/chat-turn/`. Convex side: `convex/chatRuntime.ts`
(prepareGeneration, applyEditIntentForGeneration,
markGenerationRun{Completed,Aborted,Failed}, updateAssistantSnapshot,
closeSupersededGenerationsForChat), with shared visibility in
`convex/domain/message_visibility.ts`.

**Abort chain** (sound end-to-end — do not re-litigate): `useChat().stop()` aborts the fetch → Next dev fires `req.signal` ~1s after disconnect → `streamText` forwards into the provider fetch → `onAbort` fires ~30ms later. On Stop, **both** `streamText.onAbort` and response-level `onFinish(isAborted)` flush the snapshot tracker ~200ms apart — dual-flush overlap is a known hazard class. A past livelock (boolean `pending` flag re-armed by concurrent force loops, blocking `markGenerationRunAborted` forever and OCC-starving the next `prepareGeneration`) was fixed with content-versioned dirtiness in `createDurableSnapshotTracker` plus a terminal-run guard in `updateAssistantSnapshot`. Evaluate whether those fixes are point-patches on a structurally fragile flush design.

**Deliberate behaviors — do NOT "fix" these**:

- Sidebar/Link chat navigation **remounts** the Chat page and the stream **survives to durable completion** on the server; the returning client converges via `shouldAdoptServerParts`. Nav-survival is intentional (since 2026-07-03).
- Terminal run writes are **first-wins with one exception**: `markGenerationRunCompleted` no-ops on terminal runs; `failed` may overwrite `completed` (never `aborted`) because the response envelope's `onFinish` fires for ERRORED streams too and raced `onError`.
- **Terminal outcome stubs**: empty assistant placeholders from failed/aborted runs are kept as visible first-class stubs (streaming/submitted empties stay hidden). Visibility is symmetric client/server via `convex/domain/message_visibility.ts` and **feeds the count guards** — changing visibility on one side desyncs edit/regen tokens. Regen-revert prefers `messages.regenerationSourceMessageId` over newest-sibling. The version token is validated **once, pre-sweep** (a post-sweep re-validation falsely rejected sends and was removed).

**Relevant docs**: `docs/adr/0001-client-renders-server-selected-path.md`, `docs/adr/0006-chat-turn-runtime.md`, `CONTEXT.md`.

## Investigation requirements

- Read the runtime end-to-end before forming hypotheses. Enumerate every writer to `messages`, `generationRuns`, and `assistantMessageSnapshots`, and every reader that derives a count or token from them. Produce an explicit interleaving analysis for: send∥send, send∥sweep, edit∥sweep, stop∥finish, regen∥branch-switch, nav∥stream-completion.
- **Reproduce the bug before fixing it.** Script the rapid sequence (regenerate → branch-switch → send → regenerate → edit) against a dev deployment, or instrument `expectedChatVersion` vs the server's selected-path count to catch the drift. Use the Convex MCP (`docs/convex-access.md`) to inspect `generationRuns`/`assistantMessageSnapshots` directly. If you truly cannot reproduce it, say so and fix the structural ambiguity anyway (the lag-window vs stale-extra signal gap is real regardless).
- Distinguish **confirmed defects** from **design smells**. Fix confirmed defects; for smells, fix only where the composable redesign naturally subsumes them, and document the rest.

## Fix philosophy

- Prefer the design a mature system would have over the smallest diff. Candidates worth honest evaluation (not a mandate): a server-issued monotonic chat revision replacing count-matching; a single serialized outcome/flush pipeline replacing the dual onAbort/onFinish flush; making the projection idempotently converge to the server path at idle. If the mature design requires schema changes — take them; the database is disposable and migration ceremony is explicitly dormant pre-launch.
- Extend existing seams (`projectSelectedPath`, `chat-turn-service`, the visibility module) rather than adding parallel systems. Root causes over symptoms.
- Any invariant you establish or change gets an ADR in `docs/adr/` (follow the existing numbering/style). If you replace the count guard, update ADR 0001 or supersede it.
- Tests: this repo prefers **lean** suites. Concentrate coverage on the interleavings and the guard/projection logic (the existing `*.test.ts` files beside each module show the style); do not blanket the codebase with tests.
- Use **bun** (`bun run`, `bunx`); work on the current branch, no new branches, no pushes/PRs.

## Verification & deliverables

1. Reproduction evidence (or the documented instrumentation showing the drift window) **before** the fix, and the same scenario passing after.
2. Full existing test suite green (`bun run test` / `vitest`), plus your new targeted tests.
3. Live verification of the unchanged deliberate behaviors: Stop still aborts within ~1s and marks the run aborted exactly once; nav-survival still converges; failed/aborted stubs still render symmetrically; regen-revert still honors `regenerationSourceMessageId`.
4. A written summary: the interleaving map, defects found (confirmed vs smell), the fix design and why it is the mature/composable choice, the new/updated ADR(s), and any residual known edges with their failure modes.
