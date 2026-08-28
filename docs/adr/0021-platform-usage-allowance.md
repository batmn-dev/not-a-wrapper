# 0021 — Platform usage allowance: append-only ledger with materialized buckets

**Status:** accepted **Date:** 2026-08-19 **Amends:** ADR-0020 (the
`PlatformEntitlement` seam gains its planned balance implementation: platform
candidacy now requires an atomic reservation, not just list membership) and
ADR-0011 (durable settlement gains an accounting half: every terminal
transition also settles or releases the run's usage reservation).
**Amended:** 2026-08-28 — cancellation-aware settlement (see
"Cancellation-aware settlement" below): a user Stop or supersession no longer
converts the worst-case admission reservation into final spend.

**Context.** ADR-0020 made Priority/Fallback API-key preferences real routing
tiers, but the platform tier admits by list membership (`FREE_MODELS_IDS`)
with no economic bound beyond the daily message counters — which conflate
abuse control with spend control, charge BYOK messages against a "pro model"
counter, and are enforced as a check-then-increment pair (a classic
time-of-check/time-of-use race). The product goal (T3-style included
allowance): platform-funded messages reserve estimated cost before provider
execution, settle actual cost afterward, and BYOK messages never touch the
included allowance.

**Decision.** One included allowance bucket per user per plan period,
maintained as a **materialized balance** whose every change is evidenced by an
**append-only ledger entry**, with reservation/settlement performed inside
single Convex mutations (transactional, OCC-serialized).

## Allowance unit and rounding

- **1 credit = 1 micro-USD (10⁻⁶ USD) of platform cost.** All grants,
  reservations, balances, and settled costs are integers in this unit.
  Floating-point dollars never enter accounting.
- Route rates are compiled once from the catalog's numeric
  `inputCost`/`outputCost` (USD per 1M tokens) into integer
  `inputCreditsPerMTok`/`outputCreditsPerMTok` (micro-USD per 1M tokens).
  The human-readable `priceUnit` string is display-only and never parsed.
- **Rounding:** deterministic `ceil` once per billable component (input
  tokens, output tokens, title input, title output) — never per token, never
  per delta. `ceil` is chosen so a fractional micro-USD never silently rounds
  platform cost to zero.
- A route without valid numeric pricing is **not platform-fundable** (fails
  closed). An explicitly free route ($0.00 rates) is fundable at zero credits.
- The UI presents percentages of the included allowance, never raw credits or
  dollars.

## Plan policy (provisional grant sizes — product confirmation required)

Centralized in one typed module (`convex/domain/usage_plan_policy.ts`). The
grant sizes below are **provisional placeholders** pending product-owner
confirmation; changing them is a one-constant edit:

| Plan       | Selector               | Included grant / period     | Refill interval    | Renewal anchor                      |
| ---------- | ---------------------- | --------------------------- | ------------------ | ----------------------------------- |
| free-v1    | default                | 1,000,000 credits ($1.00)   | UTC calendar month | month boundary (no per-user anchor) |
| premium-v1 | `users.premium ⩵ true` | 10,000,000 credits ($10.00) | UTC calendar month | month boundary (no per-user anchor) |

- **Bucket identity:** `(userId, bucketKind: "included", periodKey)` where
  `periodKey` is the UTC month (`"2026-08"`). Lazy creation: the first
  **reservation** of a period materializes the bucket; allowance **reads**
  project the plan's would-be grant virtually until then (Convex queries
  cannot write, and a reactive subscription must not mint rows). The
  grant ledger entry's idempotency key is `grant:{userId}:{periodKey}`, so
  the grant is idempotent by construction.
- Unused allowance does **not** roll over; a new period starts a new bucket.
  A negative prior-period balance does not carry forward (the block it
  imposed ends at the next grant — the spec's "until the next applicable
  grant").
- **Plan changes** take effect at the next bucket materialization (the
  current period's bucket keeps its `planId` and grant). **Pricing changes**
  never touch history: a reservation and its settlement use the pricing
  snapshot captured at reservation time, and ledger entries are never edited.

## Data model

- `usageBuckets` — materialized balance. Invariant (pinned by tests):
  `availableCredits = grantedCredits − spentCredits − reservedCredits`.
  Admission requires `availableCredits ≥ estimatedCredits`. Settlement may
  drive `availableCredits` negative (an actual-over-reservation overrun is
  recorded, never clamped); a negative balance blocks later reservations
  until the next grant.
- `usageReservations` — one durable record per platform-funded generation
  request, keyed by the authenticated `(userId, requestId)` before the run
  exists and attached to `generationRunId` transactionally inside
  `prepareGeneration`. Carries the pricing snapshot, estimate, payload
  fingerprint, status (`reserved → settled | released`), settlement basis,
  and final usage. Never key material.
- `usageLedgerEntries` — append-only evidence. Event types
  `grant | reserve | settle | release | adjustment` with deterministic
  idempotency keys (`reserve:{reservationId}`, `settle:{reservationId}`, …),
  enforced by an indexed read inside the same mutation. Historical entries
  are never updated or deleted; corrections are compensating `adjustment`
  entries. The bucket is the fast read model; the ledger is the audit and
  repair source.

Logical uniqueness (one bucket per period, one reservation per request, one
ledger entry per event key) is enforced by indexed reads inside the mutation
that inserts — Convex serializable transactions + OCC retries make this
race-free without SQL unique constraints.

## Atomic operations

- **Reserve** (`usageAllowance.reserveAuthorized`, authenticated mutation,
  called by the server-side route resolver walking platform candidates): verify a
  short-lived HMAC authorization over the authenticated WorkOS subject and
  EVERY immutable reservation fact → ensure current bucket → idempotency
  check on `(userId, requestId)` (an identical fingerprint on a STILL-RESERVED
  row replays; a different fingerprint, or any replay of a settled/released
  row, is a typed conflict — settled or refunded money is never re-admitted)
  → admission check → atomically decrement available, increment reserved,
  insert reservation + `reserve` ledger entry. Typed results are `reserved`,
  `insufficient_allowance`, `idempotent_replay`, `conflict`, and `rate_limited`.
  Although Convex registers the mutation publicly so the Next route can call
  it with the user's JWT, an authenticated browser cannot mint the required
  server authorization. Its domain-separated tuple covers identity, request,
  chat, route, token estimates, integer credit estimate, and the complete
  pricing snapshot. A per-user throttle of 30 requests per minute remains
  defense in depth for abuse through the legitimate server route;
  reconciliation capacity is
  no longer a security boundary for arbitrary client-created rows. There is
  no separate "check balance" query; the reservation IS the admission.
- **Attach**: `prepareGeneration` receives `reservationId` inside the signed
  admission proof (ADR-0020's HMAC tuple gains the reservation id) and
  patches `reservation.generationRunId = runId` in the same transaction that
  creates the run — a forged attach is impossible without the server proof.
- **Settle** (`settleUsageForTerminalRun`, invoked inside the same Convex
  mutation that commits the terminal lifecycle transition): for reservation
  R and actual A — `available += R − A`, `reserved −= R`, `spent += A`,
  reservation → `settled`, one `settle` ledger entry. Idempotent: a second
  settlement with the same facts returns without balance change; a
  conflicting second settlement is logged as an invariant violation and
  rejected.
- **Release** (only when provider consumption definitely did not begin):
  `available += R`, `reserved −= R`, spent unchanged. Pre-run failures use
  the unattached-release mutation (`releaseUnattached`, releases only the
  caller's own reservation while `generationRunId` is still unset — provider
  work structurally cannot have started without a run); the route arms its
  release hook the moment the reservation exists, before anything else in
  admission can throw. Settle-after-release and release-after-settle are
  rejected and logged.
- **Adjust** (`recordAdjustment`, internal-only): the ONE sanctioned
  administrative correction — appends a compensating `adjustment` ledger
  entry (caller-supplied `adjustment:*` idempotency key) and moves
  `grantedCredits` + `availableCredits` together so the materialized
  invariant keeps holding; history is never edited.

## Durable lifecycle accounting (the provider boundary rule)

**Evidence beats the boundary marker.** `run.workStartedAt` is written by a
best-effort fire-and-forget write (ADR-0011's `markGenerationWorkStarted`),
so its absence must never refund a run that provably consumed usage. The
settlement decision, in order:

| Evidence at terminal                                                                                        | Accounting                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| onEnd aggregate usage present                                                                               | settle actual (`basis: actual`; `actual_with_estimated_title` when the title call's usage never arrived, carried no token counts, or named a route absent from the pinned snapshot) |
| Per-step accumulated usage present                                                                          | settle observed (`basis: observed_partial`) — the runtime records EVERY step's usage durably, tool calls or not                                                                     |
| No evidence, `workStartedAt` never written                                                                  | release (provider consumption never began)                                                                                                                                          |
| No evidence, terminal is `provider_error` with ZERO accepted content checkpoints (`lastSnapshotSequence` 0) | release (`provider_error_before_output`) — an instant 400/401/429 is not billed by providers; charging the full estimate for a provider outage would drain allowances for nothing   |
| `user_stop` / `superseded` (cancellation)                                                                   | **accounting defers** (amendment below): the run terminalizes immediately, the reservation stays held for a bounded evidence window, then settles from the worker's receipt or the deadline fallback — never `estimated_after_unknown_usage` |
| `lease_expired` (no live worker to acknowledge)                                                             | settle immediately from durable facts via the same cancellation fallback: completed-step usage when accumulated, else estimated input plus a bounded persisted-partial-output estimate; release when provider work provably never began |
| No evidence otherwise (legacy rows, evidence-free `request_aborted`, approval/continuation strands)        | settle the reserved estimate (`basis: estimated_after_unknown_usage`) — legacy conservative behavior, retained only where no cancellation evidence channel exists                    |
| Duplicate terminal delivery                                                                                 | absorbed by first-terminal-wins **and** the reservation status guard — no second charge                                                                                             |
| Awaiting approval                                                                                           | the pause settles this run's usage; an approval continuation is a NEW request → new reservation → new run                                                                           |

Approval-expired / continuation-lost apply the same table through the shared
lifecycle-verdict path.

## Cancellation-aware settlement (amended 2026-08-28)

**Reservation is not spend.** The worst-case output reservation is an
admission-control fact; treating an unknown cancellation as proof the entire
reservation was consumed overcharged every first-step Stop. The amendment
separates **visible terminality** (immediate, unchanged: Stop commits
`aborted/user_stop` and revokes the normal execution grant in one
transaction) from **accounting finality** (deferred to a bounded
cancellation-evidence window). No user-facing state is added — accounting
pending is represented only on the reservation, which keeps
`status: "reserved"` (so the amount stays in `bucket.reservedCredits`,
fail-closed for concurrent admission) plus `terminalPendingAt`,
`settlementDeadlineAt`, `providerMayHaveStarted`, and a durable
`terminalEstimatedOutputTokens` partial-output fallback captured before
run/message cleanup can erase it.

**Settlement-only authorization.** The Stop/supersede transaction copies the
run's grant digest to `usageReservations.settlementGrantDigest` (expiring at
the same `settlementDeadlineAt`, derived from the execution budget's
settlement reserve) while clearing the run grant as before. The stopped
worker's secret then authorizes exactly ONE narrowly scoped operation — the
`finalizeTerminalUsage` worker-wire receipt for its exact run/reservation
pair — and nothing else: no snapshots, tools, approvals, heartbeats, or
lifecycle writes. Wrong-run, wrong-digest, expired, malformed, and replayed
receipts are rejected without balance changes; a receipt against an
already-finalized reservation is acknowledged as a benign no-op.

**Evidence order (deterministic, shared by receipt and reaper —
`resolveTerminalUsageSettlement`):**

1. provider work definitely never began → release (primary and an un-run
   title component);
2. authoritative aggregate usage → priced at the pinned primary route
   (`actual`; may honestly exceed the reservation);
3. completed-step usage → priced as `observed_partial`; the persisted
   partial-output estimate combines by `max()`, never by addition;
4. started without usage → `estimatedInputTokens` only
   (`estimated_input_floor`), plus a bounded estimate of persisted partial
   output when any exists (`estimated_input_with_partial_output`).

Locally estimated fallbacks are capped at the reservation; the partial
estimate is capped at `estimatedOutputTokens`. The partial-output estimator
(`lib/usage/terminal-usage-estimate.ts`) counts model output only — text,
reasoning, tool-call names + arguments — never tool results or user content.

**Title settles independently** via `titleSettlementBasis`
(`actual | input_floor | not_run`): zero when no attempt started; actual
route-pinned usage when observed; otherwise `titleEstimatedInputTokens` (the
input floor of the exact clipped title prompt, pinned at reservation time and
signed into the reservation authorization via a versioned v1→v2 proof
expansion) priced at the attempted pinned route, capped by the reserved title
component. An unknown route identity is logged and priced at the pinned
title floor.

**Deadline finality.** The first finalization wins — worker receipt, deadline
reconciler (`reconcileDueTerminalSettlements`, second-level cadence, bounded,
converging within two intervals), or the 30-minute stale reconciler as the
final crash/deploy net (pending rows route through the same fallback, never
the legacy full-estimate charge). Later conflicting evidence is logged
(`usage_terminal_late_evidence_ignored`) and can never rebill. A worker-owned
abort that beats any Stop still settles atomically: its terminal write
carries the same normalized evidence. `estimated_after_unknown_usage`
remains readable on historical rows and is never written for new
`user_stop`/`superseded` settlements.

Per-step usage evidence: `recordToolInvocations` (fired every step, not just
tool steps) now carries the step's token usage and accumulates it onto the
run row while streaming, so abort/failure/reaper settlement does not depend
on the happy-path `onEnd` callback. The runtime drains every already-started
step write before any local abort/failure/completion mutation can revoke its
grant. Completion overwrites the accumulation with the SDK's authoritative
all-steps aggregate (the existing ai@7 `onEnd` behavior is preserved).

Title usage carries the concrete `routeId` that executed the call and its
`pricingRole` (`title` or `primary`). Settlement matches both only against the
reservation's corresponding immutable snapshot, so a retired title model that
falls back to the answer route is priced at the answer route's pinned rate. An
unknown or mismatched identity is logged and uses the conservative title
estimate; it never introduces an unpinned rate or rolls back completion. During
the Convex-first deployment window, the worker validator also accepts the prior
token-only evidence shape and prices it at the reserved title route. New
workers always send route-aware evidence.

The stale-reservation reconciler (cron, batch-bounded, idempotent) is the
final net: old `reserved` rows whose run is terminal apply the boundary rule;
unattached old rows release; rows on non-terminal runs are left to the run
reapers. It never releases a reservation after provider work may have begun.

**Settlement evidence is grant-authorized only.** Because
`markGenerationRunCompleted.usage` (and the per-step usage on
`recordToolInvocations`) is now the authoritative settlement input, the
user-token registrations of the post-prepare run writes are removed: those
writes reach Convex only through ADR-0011's execution-grant worker wire
(`convex/chatRuntimeWorker.ts`, `requireGrantAuthorizedRun`). A chat owner
can therefore never call the settlement path directly and settle their own
platform reservation at a self-declared (near-zero) cost. `stopGenerationRun`
stays user-callable — it carries no usage input, and a stop settles under the
boundary rule above. The single-authenticator invariant is pinned by a test
in `convex/chatRuntime.test.ts`.

## Route resolver integration

The platform tier of ADR-0020's candidate walk becomes: entitlement rule
(model is platform-listed) → platform env credential exists → billable
pricing snapshot builds (fail closed) → **atomic reservation succeeds**. A
platform candidate is not eligible until its reservation lands; a failed
(insufficient) reservation falls through to the next platform candidate
(cheaper route) and then to fallback BYOK. At most one reservation survives
per request because the walk stops at the first success. New typed failure:
`insufficient_allowance` (mapped to a 403 `ALLOWANCE_EXHAUSTED` product
error). Route selection stays strictly before provider execution; no runtime
failover.

For authenticated users, platform funding additionally requires a **durable
chat** (reservation/settlement need the generation-run lifecycle); an
authenticated turn against a local chat id skips the platform tier.

### Authorization endpoint

The Next server calls only `usageAllowance.reserveAuthorized`; there is no
unsigned legacy reservation mutation or missing-function fallback. The HMAC
binds `NEXT_PUBLIC_CONVEX_URL`, which the verifier compares with its own
`CONVEX_CLOUD_URL`, so a captured proof cannot cross deployments. Production
and Preview must not share `CHAT_ADMISSION_SECRET`; deployments needing a
stronger boundary from sibling previews should use per-preview secrets rather
than the shared Preview default.

The initial production rollout landed directly from a baseline that exposed no
reservation endpoint, so no old server depended on a legacy signature. Future
public mutation signature changes must use an explicit expand/contract rollout
when the active Next build depends on the old signature.

## Estimation and the output policy

`estimatePlatformUsage` (pure, documented heuristics): input ≈
⌈chars/4⌉ across system prompt + history + attachments allowance + a flat
tool allowance when search/tools are enabled; output = the route-aware
per-turn budget `platformOutputTokenBudget(route)` — **8,192 tokens** base,
plus fixed-thinking headroom for routes whose provider takes a fixed thinking
budget (Anthropic today: `max_tokens` must EXCEED `thinking.budget_tokens`,
and thinking tokens are billed output). The SAME number is passed to the
provider call as `maxOutputTokens` for platform-funded runs so the
reservation and the runtime limit always agree (BYOK runs are uncapped,
unchanged). Multi-step tool turns may exceed the reservation; the overrun
settles honestly (negative balance allowed). Estimation is admission
control, not the final charge.

## Platform-paid operation inventory

| Operation                                    | Treatment                                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Main `streamText` generation (all steps)     | metered (primary snapshot)                                                                                                                    |
| Automatic title generation                   | metered (executed title or fallback route's pinned snapshot; `generateChatTitle` returns usage + route identity)                              |
| Exa search / extract on the platform key     | **subsidized**, bounded by the existing per-tool `toolLimitBuckets` budgets (platform key mode)                                               |
| Anonymous turns on `NON_AUTH_ALLOWED_MODELS` | **subsidized**, bounded by the 5/day guest limit + anonymous step cap; anonymous ids are client-controlled, so no cash-like wallet is created |
| Image/audio generation                       | not applicable today (no platform-listed route bills non-token modalities); a future one must add rates or be explicitly subsidized           |

## Existing counters

`users.dailyMessageCount` (and the anonymous counter) remain **abuse rate
limits** only. The pro-model counters (`dailyProMessageCount`,
`dailyProReset`) are retired as economic controls: no longer enforced or
incremented (fields stay optional for production compatibility; `checkUsage`
/`incrementUsage` keep accepting `isProModel` for deploy compatibility but
ignore it). The abuse increment still happens at admission — before the
credential source is known — which is now correct because it is not an
economic counter; the economic admission is the reservation itself.

## Alternatives considered

- **Mutable balance only** (LibreChat's balance schema): loses the audit
  trail, makes double-spend analysis and repair guesswork, and cannot
  explain a materialized number. Rejected — the ledger's cost is one extra
  insert per operation inside an already-open transaction.
- **Ledger only (derive balances by fold)**: every admission would read an
  unbounded row range; Convex charges per document read. Rejected in favor of
  materialized buckets with the ledger as evidence.
- **Check-then-debit split** (LibreChat's `checkBalance` middleware + later
  `spendTokens`): the TOCTOU race this design exists to remove. Rejected.
- **Charging from `priceUnit` strings / floats**: drift-prone and
  rounding-unsafe. Rejected — typed integer snapshot pinned per reservation.

**Consequences.** Priority BYOK structurally never writes allowance rows;
Fallback becomes "platform while affordable, then your key"; every platform
charge is explainable from the ledger; and a future purchased-overage bucket
is an ordered second `bucketKind` plus a reservation walk over ordered
buckets — no redesign of reserve/settle.
