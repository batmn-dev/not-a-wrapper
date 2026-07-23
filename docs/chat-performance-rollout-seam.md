# Chat-performance flag and cohort seam (PR 0b step 10)

Decision record for the repository-standard rollout seam the
chat-responsiveness plan's later phases must use (plan §6 PR 0 step 10,
correction 5, §9.2). Later phases' flag/rollout language is constrained to
exactly the capabilities documented here.

## Selected seam: build/deploy-time environment flags

The repository standard is **environment variables read through code-owned
accessors**, in two placements:

- **Client-visible flags**: `NEXT_PUBLIC_*` env vars read in `lib/flags.ts`
  (or a dedicated module), inlined into the client bundle at build time.
  Examples: `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION`,
  `NEXT_PUBLIC_ENABLE_PAGINATED_SIDEBAR`.
- **Server-only flags**: plain env vars read at call time — Next server code
  reads `process.env` directly (`CHAT_PERF_SAMPLE_RATE`); Convex functions
  read deployment env vars through `convex/lib/runtime_flags.ts`
  (`CHAT_SINGLE_PASS_BRANCH_CONTEXT`).

Alternatives considered and rejected for now:

- **PostHog feature flags**: PostHog is integrated for analytics *capture
  only*; no feature-flag API is called anywhere, and adopting the flag API
  would add a network dependency and identity coupling to the rollout path.
  Revisit only if a phase genuinely needs remote weight adjustment.
- **Convex-backed config document**: would give near-live server toggles but
  invents new infrastructure, adds a read to hot paths, and cannot reach
  build-time-inlined client code at all.

## Capabilities this seam actually provides

| Capability | Provided? | Semantics |
| --- | --- | --- |
| Kill switch (client flags) | Redeploy | Change the env var and redeploy; latency = one Vercel build/deploy (~minutes). **Not a live toggle** — no phase may claim one. |
| Kill switch (Next server flags) | Redeploy | Same as client: env changes require a redeploy of the Next app. |
| Kill switch (Convex flags) | Env change + function restart | Convex deployment env vars apply to subsequent function executions without a code deploy (set via dashboard/CLI); still not instantaneous and not client-visible. |
| Percentage cohorts | **Not provided by the seam itself** | Env flags are all-or-nothing per deployment. Cohorts require *client-local deterministic bucketing* layered on top (below). |
| Remote weight adjustment | No | Changing experiment weights is a redeploy. Experiment designs must accept that (plan PR 2 configuration note). |
| Stable per-user assignment | Via local bucketing | Deterministic local bucketing from an existing analytics identity, persisted as `{experimentVersion, variant}` in localStorage. The raw identity is never emitted in performance events. |

## Cohort assignment pattern (for PR 2+)

Percentage cohorts (the PR 2 throttle experiment) are implemented as:

1. A build-time flag enables the experiment and carries its version
   (`NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE_EXPERIMENT`).
2. The client resolves one stable variant per browser profile by hashing an
   existing analytics identity locally, persisting only
   `{experimentVersion, variant}`; reloads keep the variant, and no raw
   identity leaves the device in any performance event.
3. Weights are code constants for the experiment version — adjusting them or
   forcing control is a redeploy (the emergency path documented in the plan).

Pre-launch traffic may be too small to distinguish cohorts; §9.2's default
progression (flag off → staging → flag on with rollback watch) is the
fallback whenever cohort volume is insufficient.

## Rules for later phases

- One behavioral flag per independent change; do not couple changes.
- A phase's rollout table may only promise what the table above provides —
  in particular, never a live kill switch for a `NEXT_PUBLIC_` flag.
- Flags default to the legacy/off behavior until the phase's gates pass.
- Remove a flag only after its soak, in a separate cleanup change.
