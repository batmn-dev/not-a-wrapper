# Chat-performance flag rollout seam (PR 0b step 10)

Decision record for the repository-standard rollout seam the
chat-responsiveness plan's later phases must use (plan §6 PR 0 step 10,
correction 5, §9.2). Later phases' flag/rollout language is constrained to
exactly the capabilities documented here.

> **Status note (2026-07-23, flag collapse).** The PR 2/PR 3 behavior flags
> (`NEXT_PUBLIC_CHAT_MESSAGE_THROTTLE`,
> `NEXT_PUBLIC_STREAMING_CODE_RENDER_MODE`) no longer exist: after
> verification and the §6 freeze root-cause, the throttle became the constant
> `CHAT_MESSAGE_THROTTLE_MS` and throttled highlighting became the sole code
> render path. ADR-0016 records the current replacement architecture. This
> seam remains the standard for the diagnostic switches that still exist
> (`NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION`, `CHAT_PERF_SAMPLE_RATE`) and for
> future phases that explicitly justify a maintained flag.
> Round 2 of the collapse also removed `CHAT_SINGLE_PASS_BRANCH_CONTEXT`
> (with `convex/lib/runtime_flags.ts` itself), `ENABLE_PAGINATED_SIDEBAR`,
> and `CHAT_CONDITIONAL_EXA`.
>
> **Decision update (2026-07-27).** Durable-run presentation does not use this
> seam as a production rollout mechanism. Its
> `NEXT_PUBLIC_ENABLE_DURABLE_RUN_PRESENTATION` flag was a temporary local
> verification scaffold; the durable-turn checklist passed the same day, and
> the flag, its disabled path, and `lib/flags.ts` were removed — the
> presentation now ships unconditionally.
>
> **Streaming cadence update (2026-07-31).** The fixed
> `CHAT_MESSAGE_THROTTLE_MS` constant has been replaced by frame-aligned
> message publication. AI SDK still owns canonical message state; React
> subscriber notifications coalesce with the browser's actual paint cadence,
> and terminal/non-streaming changes flush synchronously. ADR-0016 is the
> current source of truth; the earlier flag-collapse note above is historical.

## Selected seam: build/deploy-time environment flags

The repository standard is **environment variables read through code-owned
accessors**, in two placements:

- **Client-visible flags**: `NEXT_PUBLIC_*` env vars read in `lib/flags.ts`
  (or a dedicated module), inlined into the client bundle at build time.
  Current example: `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION`.
- **Server-only flags**: plain env vars read at call time — Next server code
  reads `process.env` directly (`CHAT_PERF_SAMPLE_RATE`). No Convex runtime
  flag remains after the 2026-07-23 collapse; a future one should use a
  code-owned call-time accessor.

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
| Percentage cohorts | No | Env flags are all-or-nothing per deployment. No active phase includes cohort infrastructure. |
| Remote weight adjustment | No | The selected env-flag seam has no remote experiment weights. |
| Stable per-user assignment | No | The active scope has no experiment assignment or persistence mechanism. |

## Future cohort experiments require re-admission

No active phase uses percentage cohorts. The completed PR 1/2/3/7b work used
the deployment-wide progression in plan §9.2 before its flags were removed.

If future evidence justifies a cohort experiment, a fresh review must re-admit
it and select an assignment, versioning, privacy, and rollback design.
Client-local deterministic bucketing is one candidate, not a capability of the
active seam or a requirement for PR 2+.

## Rules for later phases

- One behavioral flag per independent change; do not couple changes.
- A phase's rollout table may only promise what the table above provides —
  in particular, never a live kill switch for a `NEXT_PUBLIC_` flag.
- Flags default to the legacy/off behavior until the phase's gates pass.
- Remove a flag only after its soak, in a separate cleanup change.

These generic rules do not override the durable-presentation decision above:
that product behavior uses local proof followed directly by flag removal and
one unconditional path, with no production flag soak.
