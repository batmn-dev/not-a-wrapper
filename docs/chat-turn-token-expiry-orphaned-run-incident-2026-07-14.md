# Incident analysis: completed Chat turn lost after the request-scoped auth token expired

| Field | Value |
| --- | --- |
| Incident date | 2026-07-14 |
| Investigation date | 2026-07-14 |
| Status | Historical report. Root cause confirmed; core remediation landed as [ADR-0011](./adr/0011-durable-turn-settlement.md), and the follow-on durable-turn plan's PRs 0–8 later landed. Do not implement from this document or treat its 2026-07-19 status labels as current backlog. Use ADR-0009, ADR-0011, `CONTEXT.md`, and current source instead. |
| Affected chat | `jh7cysfnkqjwsjd01nnjmt96ds8ajpjk` |
| Affected generation run | `js726yecyxdbyvx0s3vgwky1jd8akn7x` |
| Affected assistant message | `k571pjr8grk0jwvxy531gefvwn8ajptm` |

## Post-remediation reconciliation (2026-07-19)

This document is a historical incident record. The diagnosis, evidence, and timeline sections remain accurate as written on 2026-07-14; code references in the historical sections describe the 2026-07-14 tree and may no longer match current `HEAD`. The recommendation, outcome table, and phase labels below are frozen checkpoints from 2026-07-19: they may call work “remaining” that later landed through PRs 0–8 of the [durable-turn gameplan](./gameplans/extend-the-existing-convex-native-durable-turn-architecture.md). The optional PR 9 browser harness remained out of scope. Current implementation guidance lives in [ADR-0009](./adr/0009-durable-turn-runtime.md), [ADR-0011](./adr/0011-durable-turn-settlement.md), `CONTEXT.md`, and current source—not in this report or the historical gameplan.

### Outcome of each recommendation

| Recommendation (section) | Outcome |
| --- | --- |
| Run-scoped execution capability (Option C, systemic design §1, Phase 2) | **Implemented** — ADR-0011 execution grant: per-run 32-byte CSPRNG secret, SHA-256 digest stored on the run row, Bearer worker wire through `convex/http.ts` → grant-authorized internal mutations in `convex/chatRuntimeWorker.ts` (constant-time digest compare, expiry, run→chat→user linkage). |
| Delivery isolated from settlement; typed persistence outcome (§4, Phase 1 item 4) | **Implemented** — `settle()` never rejects; typed `DurableSettlementReceipt` (`confirmed` / `degraded` / `guest`); degraded settlement logs `durable_settlement_degraded` and the response pipe finishes cleanly. |
| Final content snapshot before the terminal transition (§3, Phase 1 item 3) | **Implemented** — unconditional final full-parts snapshot sequenced before the terminal write in `settle()`. |
| Bounded, idempotent terminal retries (§5, Phase 1 item 2) | **Implemented for terminal writes** — `settleRetryDelaysMs` (three attempts); snapshot writes remain single-shot and the final-flush failure is caught and warned, not retried. Terminal convergence was already enforced by `convex/domain/generation_run_lifecycle.ts`: first terminal wins, except `fail` may overwrite `completed`, and `aborted` is absorbing. |
| Browser recovery copy for degraded persistence (§4, Phase 1 item 5) | **Rejected** — ADR-0011 "Client contract (deliberate non-change)": content preservation is server-owned and the durable read path consults only the Convex subscription; a client copy recreates the split-brain this report warns about. Marked inline below. |
| Admission-time WorkOS freshness check / refresh (§2, Phase 1 item 1, Option B containment) | **Obsolete** — with execution grants the user token only needs to survive `prepareGeneration`; an expired token now fails at admission, before any stream begins. (Today that surfaces as a generic request error — prepare maps only argument-validation failures to 400 and the route falls back to 500; explicit 401 mapping is optional follow-up, not a durability concern.) |
| Heartbeat lease + cron reaper (§6, Phase 3) | **Remaining** — deferred (not rejected) by ADR-0011; gameplan PRs 1–3, with heartbeat re-based onto the grant-authorized worker wire. |
| Shared run-presentation resolver (§7, Phase 4 items 1–2) | **Remaining** — gameplan PRs 4–5 and 7. `Finished / Done` still renders without positive completion evidence at HEAD. |
| Ordered execution deadlines (§8, Phase 4 item 3) | **Remaining** — gameplan addendum "execution budget" (PR 0). The top-line route duration was decided 2026-07-19: 300 s. |
| Tool-budget enforcement under degraded accounting (§9, Phase 4 item 4) | **Substantially implemented** — bounded request-local cap and fail-closed behavior for non-policy errors, tested in `lib/tools`; elapsed-time/settlement-reserve inputs remain optional follow-up. |
| Phase 0 containment and audit | **Obsolete pre-launch** — the development database is disposable (AGENTS.md); the affected run may simply be administratively failed or wiped. |
| Observability/SLO program (§10) | **Partially landed; the rest is rollout-scoped** — ADR-0011's structured warn-tag vocabulary landed. The gameplan's §15 operational telemetry and alerts remain required rollout gating for the lease/reaper and presentation phases; only dashboards and SLOs are deferred until launch. |
| Amend or supersede ADR-0009 | **Done** — ADR-0011 supersedes exactly three ADR-0009 decisions and leaves the rest intact. |

A 2026-07-19 review of the landed implementation identified hardening follow-ups (grant TTL and absorbing-terminal revocation, fail/abort run→message linkage, tool-invocation terminal guard, secret-scrubber coverage for the grant secret, worker-endpoint error redaction, and the two residual mid-stream user-token writes — `toolCallLog.log` and `toolLimits.checkAndConsume`). They are absorbed into the gameplan addendum's PR 0.

### Corrections to this report

1. **Gameplan terminal-race rule.** The "Idempotent settlement" section below originally claimed the gameplan proposes a narrow `failed → completed` exception. That was wrong: the gameplan — and the implemented lifecycle table — specify the *reverse* convergence (`fail` may overwrite `completed`, because the response envelope's completion signal fires for errored streams too), keep `aborted` absorbing, and explicitly forbid relabeling a reaped run as completed. The passage is corrected inline.
2. **Evidence confidence.** The following claims are observed local behavior or inference, not documented platform behavior (checked against official docs on 2026-07-19): Convex's `InvalidAuthHeader` message (observed log string; the term appears nowhere in Convex documentation), the WorkOS default access-token lifetime and strict single-use refresh rotation (docs state tokens are JWTs and rotation "may" occur; lifetimes are dashboard-configured), the inability to persist refreshed session cookies after streaming has begun (HTTP inference; not stated by WorkOS docs), Next.js dev-server non-enforcement of `maxDuration` (implied by docs, not stated), and the "onEnd rejection fails the response pipe" mechanism (observed; consistent with vercel/ai#8052, undocumented). Documented facts: Convex mutation atomicity, Convex scheduled functions not propagating caller auth, and Vercel duration semantics — streaming counts toward `maxDuration`, and Fluid Compute allows 300 s default / 800 s max on Pro (1800 s in beta), so the current 60-second route cap is a project choice, not a platform ceiling.

## Executive summary

The trace was not empty because the model failed to answer. The model completed the turn, performed ten web searches, and produced a 3,692-character answer. The answer was lost at the boundary between model execution, durable persistence, and HTTP stream delivery.

The incident was observed in the authenticated localhost application against its configured development Convex deployment. The affected execution path is shared application code, but this investigation did not establish that a production user encountered the same failure.

The authenticated Chat route captured one WorkOS access token when the request began and reused that token for every Convex write during the turn. The run lasted long enough for the access token to expire. Once it expired:

1. Snapshot and tool-log writes began failing with Convex `InvalidAuthHeader` errors.
2. The model still finished successfully in the server process.
3. The required final `markGenerationRunCompleted` mutation failed with the expired token.
4. That mutation error escaped the stream finalizer and caused the HTTP response pipe to fail.
5. The client reported a network error and did not retain a local fallback for a server-persisted chat.
6. Convex was left with an empty assistant message and a generation run permanently marked `streaming`.
7. The UI ignored the stale durable live status after the client stream ended and inferred `Finished / Done` from the absence of a persisted terminal error.

The incident therefore contains three user-visible correctness failures:

- **Answer loss:** a completed answer never reached durable storage or the browser.
- **Orphaned liveness:** the durable run remained `streaming` indefinitely.
- **False success:** the Activity panel rendered `Finished / Done` even though completion was never durably confirmed.

The immediate bug is an expired token. The class of bug is broader: a long-running generation currently assumes that request authentication, worker authorization, persistence availability, stream delivery, and UI liveness all succeed for the same duration and fail together. They do not.

The systemic fix is to make those concerns explicit and independent:

- authenticate the user only when admitting or controlling a run;
- authorize subsequent server writes with a narrow, expiring, run-scoped capability;
- preserve streamed content before attempting the terminal transition;
- never let a persistence failure erase an otherwise deliverable answer;
- use heartbeat leases and a reaper so active runs cannot remain active forever;
- derive `Finished` only from confirmed terminal success;
- enforce one end-to-end execution deadline below the platform limit;
- continuously test token expiry, worker death, network loss, and terminal-write failure.

## User-visible symptom

The affected conversation displayed:

- the user prompt, “Please research what happened in the news today”;
- an assistant row containing only `Thought` and no answer text;
- a sidebar state that continued to say `Generating response`;
- an Activity panel with several reasoning entries followed by `Finished / Done`.

Those surfaces contradicted one another. The conversation looked empty, the sidebar looked live, and the Activity panel looked successful.

## Expected behavior

For a successful generation:

1. The assistant response is progressively visible to the browser.
2. Durable snapshots preserve meaningful partial output.
3. Tool events are recorded at most once.
4. The assistant message and generation run transition atomically to `completed`.
5. A reload reconstructs the completed response from Convex.
6. The Activity panel displays success only after a confirmed completion fact.

If persistence fails after the model has produced an answer, the user should still receive the answer when the HTTP connection is healthy. The UI should say that saving or run finalization failed, retain the content locally, and allow a bounded recovery path. It must not convert a persistence fault into an empty successful turn.

## What actually happened

### Durable state

The canonical development Convex deployment contained these facts:

| Record | Observed state |
| --- | --- |
| User message | `completed`; prompt content present |
| Assistant message | `streaming`; `content: ""`; only one reasoning part; no `finishReason` |
| Generation run | `streaming`; no `completedAt`, `finishReason`, or error |
| Snapshots | Four snapshots; all reasoning-only; final snapshot sequence `4` |
| Tool-call log | Empty |
| Canonical tool invocations | Empty |
| Chat live status | `streaming`; active run ID still set |

The final stored snapshot was written at approximately **2026-07-14 23:05:02 EDT**, 28.6 seconds after the run began. Later writes were rejected after the captured access token expired.

### Server evidence

The local development log recorded the following sequence:

1. Durable turn preparation completed.
2. Tool-budget post-accounting degraded ten times with `TOOL_POLICY_UNAVAILABLE`.
3. Ten successful built-in Web Search traces were emitted.
4. The model finished with `finishReason: stop`, `73,333` input tokens, `2,384` output tokens, and `3,692` characters of answer text.
5. Tool-log and canonical tool-invocation writes failed with:

   ```text
   InvalidAuthHeader: Could not validate token: Token expired 81 seconds ago
   ```

6. The response pipeline then failed:

   ```text
   Error: failed to pipe response
   ```

7. The browser received a network error.

The model finish occurred roughly 116 seconds after the request began. The route declares a 60-second maximum duration, so the same workload also exceeds the route's intended production execution envelope even though local development allowed it to continue.

## Timeline

Times are reconstructed from stored timestamps and ordered logs. Sub-second precision is omitted where the log did not preserve it.

| Time (EDT) | Event |
| --- | --- |
| 23:04:34 | User and assistant placeholder messages were created; generation run entered `streaming`. |
| 23:04:34–23:05:02 | Four reasoning-only snapshots were persisted. |
| Around 23:05 | The request-scoped WorkOS access token reached its `exp` time. |
| After expiry | Subsequent Convex tool and snapshot writes began failing authentication. |
| Around 23:06:30 | The provider finished successfully after ten searches and produced 3,692 characters. |
| Immediately after finish | The terminal completion mutation used the expired token and rejected. |
| Immediately after rejection | AI SDK response piping failed; the browser saw a network error. |
| After the failed request | Convex still showed `streaming`; the browser rendered the turn as settled and the Activity panel inferred `Finished / Done`. |
| 23:25 | The inconsistent empty trace was observed in the UI. |

## Request and failure flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant R as Next.js Chat route
    participant W as WorkOS session
    participant C as Convex
    participant M as Model and tools

    B->>R: POST /api/chat
    R->>W: Read session once
    W-->>R: User plus access token
    R->>C: Prepare run with user token
    C-->>R: Run and assistant message IDs
    R->>M: Start streaming generation
    M-->>R: Reasoning and tool activity
    R->>C: Persist snapshots with same token
    Note over W,R: Access token expires while generation continues
    M-->>R: Final answer, 3,692 characters
    R-xC: Complete run with expired token
    C-->>R: InvalidAuthHeader
    R-xB: Stream finalizer rejects; failed to pipe
    Note over C: Assistant content remains empty; run remains streaming
    Note over B: Network error, then false Finished presentation
```

## Root cause

### Primary root cause

The Chat route treats a request-scoped WorkOS access token as a long-lived worker credential.

[`app/api/chat/route.ts`](../app/api/chat/route.ts) reads the WorkOS session once and stores `authSession.accessToken` as `convexToken`. That token is then captured by the durable runtime and reused for writes that may occur minutes later.

WorkOS access tokens are JWTs with a fixed expiration. Reading an existing session does not make the already-issued access token immortal, and the route does not refresh or replace it during the generation. The generation outlived the token.

### The destructive coupling

The token expiry became answer loss because durable settlement is awaited inside response finalization.

[`app/api/chat/durable-turn-runtime.ts`](../app/api/chat/durable-turn-runtime.ts) calls `markGenerationRunCompleted` with the captured token in `finalize()`. The rejection is not converted into a recoverable persistence result. It propagates through stream finalization, so a database authentication failure also becomes an HTTP delivery failure.

This makes two independent outcomes incorrectly atomic:

- **Generation/delivery outcome:** the model produced an answer that could still be sent to the browser.
- **Persistence outcome:** Convex accepted the terminal record.

The current implementation discards both when the second outcome fails.

### Why the browser did not preserve the answer

[`lib/chat-turn/turn-store.ts`](../lib/chat-turn/turn-store.ts) intentionally avoids caching partial assistant output after an abort, disconnect, or error when the route is expected to persist the chat. That normally prevents duplicate sources of truth. In this failure mode, however, the durable route did not persist the answer and the client also declined to keep it. There was no surviving copy.

### Why the run remained live forever

No independent liveness authority expired the orphaned run. The terminal mutation failed, and there is no heartbeat lease plus server-side reaper currently guaranteed to convert an abandoned active run to a terminal failure.

The accepted durable-turn architecture already identifies this need. [`docs/gameplans/extend-the-existing-convex-native-durable-turn-architecture.md`](./gameplans/extend-the-existing-convex-native-durable-turn-architecture.md) proposes generation-run leases, heartbeats, first-terminal-wins transitions, and a Convex cron reaper. This incident is direct evidence that those controls are correctness requirements, not optional resilience polish.

### Why the Activity panel claimed success

[`app/components/chat/conversation.tsx`](../app/components/chat/conversation.tsx) deliberately ignores durable `submitted` and `streaming` statuses after the local client stream has settled. This prevents a stale server status from resurrecting a spinner after a stopped or dropped stream.

That local rule is reasonable in isolation, but the system currently lacks a separate concept for “local stream ended without confirmed durable outcome.” The message therefore becomes render-ready even though Convex still says `streaming`.

[`lib/chat-messages/assistant-activity.ts`](../lib/chat-messages/assistant-activity.ts) then defaults the completion row to `Finished / Done` unless it finds an explicit failed, errored, denied, stopped, or aborted fact. Because the failed terminal write never persisted an error, absence of failure was interpreted as success.

This is a semantic error: **unknown is not success**.

## Five-whys analysis

1. **Why was the assistant response empty?**

   The final assistant content was neither durably committed nor retained by the browser.

2. **Why was it not durably committed?**

   The completion mutation used an expired WorkOS access token and Convex rejected it.

3. **Why was an expired user token still being used?**

   The route captured the access token once at request admission and reused it as the server worker's credential for the whole run.

4. **Why did a persistence rejection erase an already-completed model response?**

   The terminal mutation is awaited inside stream finalization, and its rejection is allowed to fail the response pipe.

5. **Why did the system neither recover nor present an honest failure?**

   There is no independent run lease/reaper, no terminal-write recovery boundary, no durable-or-local content fallback for this exact split-brain outcome, and the presentation layer treats missing failure evidence as completion.

## Contributing factors

### 1. The run substantially exceeded its nominal execution envelope

[`app/api/chat/route.ts`](../app/api/chat/route.ts) declares `maxDuration = 60`, while the observed run took approximately 116 seconds. Local development did not terminate it, but a production platform may. Token expiry exposed this incident; platform termination could create the same orphaned state by a different mechanism.

Increasing `maxDuration` can make a specific workload fit, but it does not establish a correctness boundary. The provider/tool deadline, route maximum, worker capability lifetime, heartbeat lease, and cleanup threshold need to be deliberately ordered.

### 2. Tool-budget accounting degraded open

The log contains ten `tool_budget_post_accounting_degraded` events and ten successful Web Search traces. The policy service was unavailable, yet the run continued to the cap and accumulated 73,333 input tokens.

This was not the direct cause of the lost answer, but it lengthened the request and increased exposure to token expiry and platform termination. Budget enforcement must happen before dispatch, must account for multiple tool calls emitted in one model step, and must have an explicit fail-open or fail-closed product policy. A “maximum” that can be exceeded during a degraded dependency is not a reliable execution bound.

### 3. User authentication and worker authorization share one credential

The user's JWT is appropriate for proving who initiated a run. It is a fragile choice for authenticating internal writes after the request has been admitted because:

- its lifetime is independent of the provider's execution time;
- refresh-token rotation introduces concurrency concerns;
- response headers/cookies may already be committed when a refresh is needed;
- a user logging out or losing a session should not corrupt a server run that was already authorized;
- every late write inherits a broader user credential than it needs.

### 4. Terminal persistence is a single awaited edge

The completion write contains the final text, parts, metadata, finish reason, usage, and tool counts. When it fails, the system loses both the terminal status and the only complete answer payload. Earlier snapshots are useful only if they remain authorized and contain substantive text.

### 5. Liveness and presentation are inferred from different authorities

The server says the run is live forever; the client says its stream is over; Activity says it finished. There is no shared resolver that combines durable terminal facts, lease freshness, local stream state, and persistence health into one presentation outcome.

## What this was not

- **Not an empty model response.** The provider produced 3,692 characters and stopped normally.
- **Not primarily a rendering bug.** The final answer was absent from both Convex and the browser after the failed pipe.
- **Not a failed web-search tool call.** The server recorded ten successful Web Search traces before persistence of their canonical records failed.
- **Not only a stale spinner bug.** The stale status is a durable state-machine failure, not merely missing UI cleanup.
- **Not fixed by changing `Finished` copy alone.** That would hide one contradiction while leaving answer loss and orphaned runs intact.
- **Not fixed by increasing token duration alone.** Any finite user token can still expire before a slow provider, tool, network, or platform cleanup completes.

## Existing architecture decision exposed by the incident

[`docs/adr/0009-durable-turn-runtime.md`](./adr/0009-durable-turn-runtime.md) documents the current contract: the Convex token crosses the runtime boundary once, and `finalize()` may reject when the completion write fails. This incident demonstrates that the accepted envelope has an unsafe consequence: terminal persistence failure is allowed to invalidate response delivery.

ADR-0009 should be amended or superseded so that:

1. request authentication does not define the worker-write lifetime;
2. final persistence produces a typed persistence outcome rather than an uncaught stream failure;
3. answer delivery and durable settlement have separate, observable states;
4. an active run always has a lease and a deterministic terminal recovery path.

## Approach decision

This is an auth and concurrency boundary, so the repair should be chosen explicitly rather than assembled from local retries.

### Option A: Increase WorkOS access-token and route duration

**Benefits**

- Small configuration change.
- Reduces the probability of this exact expiry during normal turns.

**Problems**

- Does not eliminate the race; it only moves it.
- Broadens the lifetime of a user credential.
- Does not handle provider hangs, Convex outages, browser disconnects, worker death, or platform termination.
- Does not repair orphaned runs or false success presentation.

**Decision:** Useful only as temporary risk reduction, not an acceptable fix.

### Option B: Refresh the WorkOS session before each late Convex write

**Benefits**

- Preserves the existing user-authenticated mutation model.
- Can rescue some writes when the refresh token remains valid.

**Problems**

- Couples every worker write to the user's refresh-token lifecycle.
- Refresh-token rotation and concurrent requests require careful serialization.
- Refreshing after streaming headers are committed may not safely persist updated session cookies.
- Logout, session revocation, or refresh-provider failure can still orphan an authorized server run.
- Every snapshot and tool write still carries user-level authority.

**Decision:** Add an admission-time freshness check as a containment measure, but do not make mid-run session refresh the durable execution architecture.

### Option C: Separate user admission from server execution with a run-scoped capability

**Benefits**

- A valid user session authorizes creation of exactly one run.
- Subsequent server writes are limited to that run, assistant message, request, operation set, and expiry.
- Worker writes no longer depend on user access-token refresh timing.
- The capability can be shorter-lived and narrower than a general user or deployment credential.
- It creates a clean boundary for idempotency, retries, heartbeats, and terminal transitions.

**Costs and risks**

- Introduces a new security-sensitive capability and validation path.
- Requires careful secret generation, hashing, expiration, redaction, and constant-time comparison.
- Every mutation must verify run/message/chat linkage and allowed state transitions.
- Needs focused threat-model review and failure-injection tests.

**Decision:** **Recommended.** Use the user's WorkOS JWT for admission and user-driven control commands; use an expiring, server-only, run-scoped capability for the admitted worker's durable writes.

Do not use a Convex deployment admin key or an unrestricted static shared secret for ordinary Chat writes. The capability must have the minimum authority necessary for one run.

## Recommended systemic design

### 1. Admission: authenticate the user once and create an execution grant

The route should obtain a valid WorkOS session before streaming headers are sent. The authenticated prepare mutation should verify chat ownership and create:

- the user message;
- the assistant placeholder;
- the generation run;
- an execution grant bound to `runId`, `assistantMessageId`, `chatId`, `requestId`, an allowed operation set, and an expiry.

One feasible implementation is:

1. The Next.js server generates a cryptographically random capability secret.
2. It passes only a hash or verifier to the authenticated prepare mutation.
3. Convex stores the verifier on the run or in a one-to-one execution-grant record.
4. The raw capability stays only in server memory and is never sent to the browser, stored in logs, or persisted in plaintext.
5. Dedicated worker mutations require the run ID and capability, validate the verifier and expiry, then enforce exact record linkage and transition guards.
6. The terminal transition revokes the grant. The reaper also revokes expired grants.

The capability should allow only operations such as:

- append a monotonic assistant snapshot;
- record a canonical tool transition;
- heartbeat the run lease;
- mark the run completed, failed, or aborted under first-terminal-wins rules.

It must not permit reading arbitrary user data, creating unrelated chats, changing ownership, or writing another run.

### 2. Credential freshness: reject unsafe admission before work begins

As immediate defense in depth, decode the WorkOS access token's `exp` claim at admission and ensure it has enough remaining lifetime to complete the authenticated prepare phase. If it is close to expiry, use the WorkOS SDK's supported refresh path before returning a streaming response.

This check improves admission reliability but is not the execution credential. The run-scoped capability remains authoritative after prepare.

Never log the access token, refresh token, execution capability, or capability verifier input.

### 3. Content durability: make the latest semantic answer survive terminal failure

The complete answer must not exist only inside the final mutation payload.

- Continue monotonic snapshots throughout generation under the run capability.
- Persist semantic text/parts frequently enough that a worker killed before terminal settlement leaves a useful partial answer.
- Force or flush a final content snapshot before attempting the terminal state transition.
- Make snapshot writes idempotent by `(runId, sequence)` and reject regressive sequences.
- Keep content preservation independent from whether the run ultimately becomes `completed`, `failed`, `aborted`, `superseded`, or `lease_expired`.

If the final content snapshot succeeds and the completion transition fails, the reaper can honestly mark the run failed while retaining the full answer with an interrupted/persistence-warning presentation. It should not silently relabel that answer as completed.

### 4. Delivery isolation: persistence failure must not destroy a deliverable answer

The stream finalizer should return a typed outcome, for example:

```ts
type DurableSettlement =
  | { status: "completed"; runId: string }
  | { status: "persistence_degraded"; runId: string; retryable: boolean }
```

The HTTP response should finish cleanly when the model stream itself succeeded, even if the terminal persistence attempt exhausted its bounded retries. The final UI message should retain the answer and surface a specific saving/finalization warning.

This does not mean pretending persistence succeeded. It means preserving two facts:

- the generation result was delivered;
- durable settlement is degraded or unconfirmed.

> **[Superseded 2026-07-18 — do not implement.]** ADR-0011 rejected this client recovery copy: durable-chat content preservation is server-owned (the unconditional final full-parts snapshot), the durable read path consults only the Convex subscription, and a client-held copy recreates exactly the split-brain this report warns about. The rule is documented at the seam in `lib/chat-turn/turn-store.ts`. The remaining loss window — Convex entirely unreachable for the whole settlement tail while the stream delivered fine — is accepted and observable via `durable_settlement_degraded`. The original recommendation is preserved below for the historical record.

The browser should retain a local recovery copy for that case, keyed by chat, run, and assistant message IDs. A later confirmed durable snapshot or terminal record can clear it. This fallback must be narrowly scoped to degraded persistence so it does not create a permanent second source of truth.

### 5. Idempotent settlement: retry safely without duplicating state

All worker writes should accept stable request/run IDs and be idempotent.

- Retry transient network and service errors with a small bounded backoff.
- Do not retry authorization failures with the same rejected credential.
- Treat a repeated identical terminal transition as success.
- Enforce first-terminal-wins for competing terminal outcomes.
- Allow only the explicitly documented recovery exception, if any, for a late completion racing a lease reaper.
- Record terminal attempt count and final persistence result in telemetry.

**[Corrected 2026-07-19]** An earlier version of this paragraph claimed the gameplan proposes a narrow `failed -> completed` exception. It does not: the gameplan specifies the reverse convergence — `fail` may overwrite `completed` (the response envelope's completion signal fires for errored streams, so both commit orders must converge to failed), `aborted` is absorbing, and a reaped run becomes `failed`, never fake-completed. That rule is implemented and regression-tested in `convex/domain/generation_run_lifecycle.ts`. The conservative policy this paragraph asked to be decided is therefore already decided: preserve the answer, keep the run failed after the lease expires. What must not happen is an unguarded late write that resurrects or overwrites a newer run.

### 6. Liveness: heartbeat, lease, and reap every active run

Implement the existing Convex-native liveness plan:

- `generationRuns` is the sole durable liveness authority.
- Each active run has `heartbeatAt` and `leaseExpiresAt`.
- The server worker heartbeats at a fixed interval under its run capability.
- A Convex cron invokes an internal reaper mutation.
- The reaper marks expired active runs terminal with a machine-readable reason such as `lease_expired`.
- Terminal transitions clear the chat's active-run projection only if the IDs still match.
- Reaping and late worker writes obey first-terminal-wins and exact linkage checks.

No active run should be able to remain active indefinitely, even if the Next.js process is killed without running `catch`, `onError`, `onFinish`, or `finally`.

### 7. Presentation: success requires positive success evidence

Create one shared run-presentation resolver that consumes:

- durable run status;
- terminal reason;
- heartbeat/lease freshness;
- local AI SDK stream status;
- whether answer content exists;
- whether delivery succeeded;
- whether durable settlement is confirmed or degraded.

It should produce a small explicit vocabulary:

| Condition | Conversation | Activity completion | Sidebar |
| --- | --- | --- | --- |
| Local stream live and lease fresh | Live | Working | Generating |
| Durable `completed` | Answer | Finished | Settled |
| Answer delivered, persistence degraded | Answer plus save warning | Answer generated; save unconfirmed | Needs attention |
| Lease expired with partial content | Partial answer plus interruption notice | Interrupted | Settled/failed |
| Durable `failed` | Error/partial answer | Run failed | Settled/failed |
| No terminal fact and lease freshness unknown | Status unknown | Status unknown | Reconnecting or needs attention |

`Finished` must require a positive completion fact. It must never be the default merely because the local stream is no longer live.

Keep this resolver upstream of both the conversation row and Activity panel. Do not create separate row-local interpretations of raw AI SDK and Convex states.

### 8. Execution budget: one ordered deadline model

Define one end-to-end budget and derive every subordinate deadline from it:

```text
provider and tool deadline
  < final snapshot and settlement deadline
  < route/platform maximum duration
  < execution capability expiry
  < lease-reaper grace threshold
```

For example, if the route is allowed to run for `R` seconds, model/tool work must be aborted with enough reserve for final snapshot, terminal mutation retries, and a clean SSE close. The exact numbers should come from production latency data rather than the example values in the existing gameplan.

The current 60-second route limit and observed 116-second successful model execution are inconsistent. Choose one of these product policies explicitly:

- cap/abort tool and model work early enough to finish within 60 seconds; or
- raise the platform duration and all related budgets after confirming deployment-plan support and cost.

Raising the route duration without reserving settlement time is not sufficient.

### 9. Tool budget: enforce before dispatch and across batched calls

The run emitted ten Web Search traces while budget post-accounting was degraded. The budget layer should:

- reserve capacity before tool dispatch;
- count every call in a batched model step before executing any over-budget call;
- make the degraded policy explicit and observable;
- stop issuing new tools when the hard local cap is reached even if a remote accounting service is unavailable;
- include elapsed-time and remaining-settlement-reserve checks in the decision.

This reduces cost and bounds exposure to every long-run failure mode, including but not limited to token expiry.

### 10. Observability: measure the invariants directly

Add structured events and alerts for:

- `chat_run_admitted` with token lifetime remaining as a number, never the token;
- snapshot write success/failure and last persisted sequence;
- tool call requested, budget decision, execution result, and canonical-write result;
- heartbeat success/failure and lease age;
- terminal write attempt, retry count, result, and latency;
- bytes or characters generated, delivered, snapshotted, and terminally persisted;
- response stream outcome separately from durable settlement outcome;
- reaper transitions and late-worker conflicts;
- active runs older than their maximum legitimate age;
- assistant messages with empty content whose run is terminal or stale;
- Activity `Finished` presentations without a durable completion fact.

Recommended invariant alerts:

```text
active_run_age > platform_max + grace                    == 0
completed_run_without_completed_assistant_message         == 0
finished_presentation_without_confirmed_completion         == 0
generated_characters > 0 && persisted_characters == 0      == 0
tool_calls_executed > configured_hard_cap                  == 0
```

## Recommended remediation sequence

### Phase 0: contain and audit

*Status 2026-07-19: obsolete pre-launch (the development database is disposable); only the administrative disposition of the affected run remains an open choice.*

1. Query for all non-terminal generation runs older than the legitimate execution envelope.
2. Report the affected chat/run/message IDs and preserve their partial content before cleanup.
3. Mark stale runs with an explicit administrative recovery reason; do not silently label them completed.
4. Add temporary alerting for old active runs and failed terminal mutations.
5. For the affected run in this report, choose explicitly whether to retain it as incident evidence or administratively mark it failed. This investigation did not mutate it.

### Phase 1: prevent answer loss at the current boundary

*Status 2026-07-19: items 3–4 landed via ADR-0011; item 2 is partial (terminal writes retry with bounded backoff; snapshot writes are single-shot and the final-flush failure is caught, not retried); item 1 is obsolete for durability (execution grants removed the mid-run token dependency from durable-run writes); item 5 was rejected (see the superseded marker in systemic design §4); item 6 is partial — durable failed/aborted/awaiting-approval outcomes now render first-class, but the shared resolver (Phase 4) still owns the rest.*

1. Refresh near-expiry WorkOS sessions before admitting a stream.
2. Add bounded retry and typed failure handling around snapshot and terminal writes.
3. Flush a final content snapshot before terminal settlement.
4. Prevent a terminal persistence error from rejecting an otherwise successful response pipe.
5. Retain a narrowly scoped browser recovery copy when delivery succeeds but durable settlement is unconfirmed.
6. Change Activity presentation so unconfirmed outcomes are not labeled `Finished`.

This phase reduces immediate user harm but still should not rely indefinitely on a user token for worker writes.

### Phase 2: introduce run-scoped worker authorization

*Status 2026-07-19: core implemented — ADR-0011 (PR #121) moved snapshots, tool-invocation records, approval requests, and terminal transitions onto grant-authorized worker mutations. Not yet on the wire: heartbeats (they do not exist yet — Phase 3) and two mid-stream writes that still ride the user token (`toolCallLog.log`, `toolLimits.checkAndConsume`). Hardening follow-ups are gameplan addendum PR 0.*

1. Threat-model and specify the execution capability.
2. Add the verifier/expiry to the durable run model.
3. Create dedicated, exact-scope worker mutations.
4. Move snapshots, tool logs, heartbeats, and terminal transitions to those mutations.
5. Keep user JWT authorization for admission and user-initiated control operations.
6. Remove the captured user access token from the long-running runtime after prepare.

### Phase 3: make liveness self-healing

*Status 2026-07-19: remaining — gameplan PRs 1–3, with heartbeat re-based onto the grant-authorized worker wire.*

1. Implement heartbeat and lease fields.
2. Add the Convex cron/internal reaper.
3. Apply status guards and first-terminal-wins to every write.
4. Preserve partial/full content when reaping.
5. Update chat projections atomically and only when IDs match.

### Phase 4: unify presentation and execution limits

*Status 2026-07-19: remaining — gameplan PRs 4–7 plus the addendum's execution budget; tool-budget degradation handling (item 4) already substantially landed.*

1. Add the shared run-presentation resolver.
2. Replace inferred success with positive terminal evidence.
3. Align tool/model deadlines, settlement reserve, route duration, capability expiry, and reaper grace.
4. Make tool budgets enforceable during dependency degradation.
5. Add dashboards and SLOs for the invariants above.

## Required regression and failure-injection tests

### Authentication and capability tests

- User access token expires immediately after authenticated prepare; worker snapshots and settlement still succeed with the run capability.
- A capability for run A cannot write run B, another assistant message, another chat, or another user.
- An expired or revoked capability cannot write.
- A browser-supplied capability is rejected; the raw capability never appears in the request body from the client.
- Logs, Sentry payloads, errors, and stored records never include raw WorkOS or execution credentials.
- Concurrent session refreshes do not corrupt or rotate away the active browser session.

### Persistence and delivery tests

- Snapshot write fails transiently, retries, and later succeeds without duplication.
- Terminal write fails once and succeeds on retry.
- Terminal write remains unavailable after the model finishes; the browser still receives and retains the answer with a persistence warning.
- The final snapshot succeeds but terminal settlement fails; reload preserves content and shows an interrupted/unconfirmed outcome.
- Convex rejects authentication before the first snapshot; the response does not claim durable success.
- A response-pipe failure does not falsely mark the run completed.
- A successful durable completion followed by a client disconnect remains completed and reloadable.

### Liveness and concurrency tests

- The worker is killed before any output; the lease expires and the reaper marks the run failed.
- The worker is killed after partial text; the partial answer survives and the run is reaped.
- The worker is killed after final content snapshot but before completion; content survives and the outcome is honest.
- A late completion races the reaper; the documented transition rule produces one deterministic result.
- A superseded run cannot overwrite the active-run projection of its successor.
- Re-running the reaper is idempotent.
- Two terminal writes with the same payload are idempotent.
- Conflicting terminal writes obey first-terminal-wins.

### Deadline and budget tests

- Provider work approaches the route deadline; it is aborted with enough reserve to snapshot, settle, and close the stream.
- Platform termination is simulated without cleanup hooks; the reaper recovers the run.
- Multiple tool calls emitted in one model step cannot exceed the hard cap.
- Remote tool-budget accounting is unavailable; the documented local degraded policy is enforced.
- Tool calls stop when the remaining time is smaller than the settlement reserve.

### Presentation tests

- Durable `completed` renders `Finished`.
- Durable `failed` renders `Run failed`.
- Lease expiry renders `Interrupted`, not `Finished` or an infinite spinner.
- Local stream end plus durable `streaming` and a stale lease renders `Status unknown` or `Interrupted` according to the shared resolver.
- Delivered answer plus persistence degradation renders the answer and a save warning.
- No terminal fact can produce `Finished / Done`.
- Conversation, Activity panel, sidebar, and reload all derive the same outcome.

## Acceptance criteria

The class of bug is considered fixed when all of the following are true:

1. A user access token expiring after run admission cannot prevent the admitted server worker from writing that run.
2. No database failure can erase an answer that was otherwise successfully delivered to the browser.
3. Meaningful partial or final content survives worker death whenever at least one snapshot succeeded.
4. Every active run either completes within its lease or is automatically moved to an honest terminal state.
5. No UI surface displays `Finished` without positive completion evidence.
6. Tool calls cannot exceed the configured hard cap, including in degraded accounting mode and batched tool steps.
7. Provider/tool work always leaves a measured reserve for snapshot, settlement, and stream close.
8. All worker mutations are run-scoped, idempotent, status-guarded, and incapable of cross-run writes.
9. Operational dashboards can identify answer loss, orphaned runs, failed settlement, and inconsistent presentation without manual database inspection.
10. The failure-injection matrix runs in CI for the durable-turn boundary.

## Additional insights

### “Durable” must describe an invariant, not a route preference

The client currently uses “route persists” to decide not to cache an errored response. That is a routing expectation, not proof that persistence succeeded. The relevant fact is whether a durable write was confirmed. Client cleanup should therefore consume a persistence outcome, not infer it from the chat ID or route type.

### Completion is a compound fact

A Chat turn can independently have:

- model execution completed;
- answer delivered;
- answer snapshotted;
- terminal state committed;
- client acknowledged;
- UI reconstructed after reload.

Collapsing all six into one `ready`/`finished` boolean makes split-brain states invisible until a user sees contradictory UI. The data model and telemetry should preserve these distinctions even if the normal UI presents them simply.

### Refreshing credentials is not the same as designing worker identity

Session refresh is necessary for normal browser continuity, but it should not be the backbone of a server workflow that has already been authorized. A run-scoped capability narrows authority and makes its lifetime match the work. It also creates a testable security boundary rather than relying on the incidental lifetime of an identity-provider JWT.

### A reaper repairs liveness, not lost output

Lease expiry prevents infinite `streaming`, but it cannot reconstruct a final answer that only existed in a terminated process. Frequent semantic snapshots and delivery isolation are still required. Liveness, content durability, and delivery are complementary controls.

### Increasing timeouts can increase risk

A longer route limit may reduce platform kills, but it also permits more tools, cost, and time for credentials or dependencies to fail. Duration changes should be paired with explicit provider deadlines, settlement reserve, tool caps, and capability expiry.

## Evidence locations

### Repository code and architecture

- [`app/api/chat/route.ts`](../app/api/chat/route.ts), lines 20 and 58–64 — declares `maxDuration = 60` and captures the WorkOS access token once.
- [`app/api/chat/durable-turn-runtime.ts`](../app/api/chat/durable-turn-runtime.ts), lines 959–973 — awaits the completion mutation with the captured token in `finalize()`; the runtime also uses that credential for snapshots, tool writes, and failure settlement.
- [`lib/chat-turn/turn-store.ts`](../lib/chat-turn/turn-store.ts), lines 122–164 — skips local partial caching when the route is expected to persist.
- [`app/components/chat/conversation.tsx`](../app/components/chat/conversation.tsx), lines 192–209 — ignores durable live statuses after local stream settlement.
- [`lib/chat-messages/assistant-activity.ts`](../lib/chat-messages/assistant-activity.ts), lines 292–328 — defaults to `Finished / Done` in the absence of explicit failure evidence.
- [`docs/adr/0006-chat-turn-runtime.md`](./adr/0006-chat-turn-runtime.md) — current stream/persistence runtime contract.
- [`docs/adr/0009-durable-turn-runtime.md`](./adr/0009-durable-turn-runtime.md) — current durable runtime boundary and rejecting finalizer semantics.
- [`docs/gameplans/extend-the-existing-convex-native-durable-turn-architecture.md`](./gameplans/extend-the-existing-convex-native-durable-turn-architecture.md) — proposed leases, heartbeats, reaper, status guards, and partial-content preservation.
- `.next/dev/logs/next-development.log` — transient local evidence for the model finish, tool-budget degradation, token-expiry failures, and failed response pipe.

### Official references

- [WorkOS AuthKit sessions](https://workos.com/docs/authkit/sessions) — access-token expiration, refresh tokens, rotation, and session lifetime.
- [WorkOS AuthKit Next.js SDK](https://workos.com/docs/sdks/authkit-nextjs) — supported Next.js session integration.
- [WorkOS session helpers](https://workos.com/docs/reference/authkit/session-helpers) — session refresh behavior.
- [Convex authentication overview](https://docs.convex.dev/auth/overview) — user and service authentication boundaries.
- [Convex authentication in functions](https://docs.convex.dev/auth/functions-auth) — function identity behavior.
- [Convex custom JWT authentication](https://docs.convex.dev/auth/advanced/custom-jwt) — custom JWT validation.
- [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions) — durable scheduling and non-propagation of caller auth.
- [Convex cron jobs](https://docs.convex.dev/scheduling/cron-jobs) — recurring server-side reaper mechanics.
- [Convex actions](https://docs.convex.dev/functions/actions) — external work, mutation boundaries, and retry characteristics.
- [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration) — function duration includes streaming time.
- [Vercel Functions up to 30 minutes](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes) — current platform duration options; availability must be verified against this project's plan and runtime.

## Investigation boundaries

- The affected Convex records were read but not edited.
- No retry was issued against the model because the objective was to preserve and explain the failure evidence.
- No production code, schema, configuration, auth path, or dependency was changed.
- No access token, refresh token, API key, or execution credential is included in this report.

## Final conclusion

The trace is empty because the system lost a completed answer during durable finalization. The WorkOS access token captured at request start expired while the model and tools were still running. Convex rejected late writes, the awaited completion mutation broke the response pipe, the browser had no durable-chat fallback, the run had no lease-based recovery, and the presentation layer mistook missing failure evidence for success.

The durable fix is not a longer token or a different label. It is a lifecycle redesign at the existing durable-turn seam: **user-authenticated admission, run-scoped worker authorization, monotonic content snapshots, delivery isolated from settlement, idempotent terminal writes, lease-based recovery, bounded execution, and a shared presentation resolver that requires positive success evidence.**
