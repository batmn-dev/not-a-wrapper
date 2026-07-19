# Durable-turn implementation notes — 2026-07-19

Companion record to
[extend-the-existing-convex-native-durable-turn-architecture.md](./extend-the-existing-convex-native-durable-turn-architecture.md)
(the plan file has unrelated local edits in flight, so accepted deviations are
recorded here instead of inline in its §0 addendum). PRs 0–8 landed on
`darknight/otisburg`; PR 9 (E2E harness) was out of scope as specified.

## Accepted deviations / clarifications

1. **Grant revocation required a wire-side complement (PR 0).** Clearing
   `grantDigest` on absorbing outcomes turns the previously-benign
   double-terminal writes (envelope abort after stream abort; spurious
   completion after a landed failure) into grant rejections at the endpoint
   instead of in-handler lifecycle no-ops. Unhandled, every user Stop would
   have produced a false `durable_settlement_degraded`. The worker wire now
   surfaces typed grant rejections (`DurableWorkerWriteError`), and
   `writeTerminal` absorbs `grant_unauthorized` as idempotent settlement
   (`durable_terminal_write_rejected_settled`, no retries) and treats
   `grant_expired` as non-retryable. Same semantics as before revocation,
   different door.

2. **The §19 "does the SDK evaluate `sendAutomaticallyWhen` on hydration?"
   question was made moot instead of pinned (PR 8).** The layer-3 client gate
   requires a LOCALLY-resolved approval id before auto-send can arm, so
   adopted approval-responded parts cannot dispatch regardless of the SDK's
   hydration behavior — this is the plan's own "strip/normalize" fallback,
   implemented as a gate.

3. **`approvals-resolved` with a denial carries no `terminalReason`** — no
   member of the §5 union describes "user denied the approval", and inventing
   vocabulary was worse than an optional field (documented in the lifecycle
   module).

4. **Background/stale presentation rides an effective transport status
   (PR 5).** The resolver is authoritative; a client-classified FRESH
   background run renders as streaming through the existing row/panel/
   announcer pipeline. Dedicated §11 copy ("Generating in background",
   "Checking generation status"), the offline run-scoped Stop intent queue,
   activity timer-freeze wording, and dedicated announcer strings are
   remaining polish on top of the landed resolver — the durable-correctness
   invariants (no zombie loader anywhere, terminal cuts the local stream,
   freshness-bounded sidebar) are complete and tested.

5. **Provider-deadline enforcement landed with PR 2**, composed as
   `AbortSignal.any([request, worker-loss, AbortSignal.timeout(providerDeadline)])`
   in the Chat turn runtime — the addendum left the wiring point open; the
   budget module stayed the single source of the value.

## Live verification performed

- PR 3 reaper: a seeded expired-lease streaming run on the dev deployment was
  reaped by the **cron itself** within one tick — `failed/lease_expired`,
  partial content preserved, sidebar projection cleared; probe rows and the
  probe module were removed afterward.
- Every Convex push (`bunx convex dev --once`) validated schema and bundling
  against the real dev deployment after each PR.
