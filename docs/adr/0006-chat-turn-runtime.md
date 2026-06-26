# 6. The chat route is a thin HTTP adapter over a deep Chat turn runtime

- Status: accepted
- Date: 2026-06-26
- Context: Architecture deepening — chat request path; branch `darknight/crime-alley`
- Related: ADR-0003 (authenticated handler seam — the same "make a re-derived
  orchestration structural" move on the Convex side)

## Context

`app/api/chat/route.ts` (~1688 lines) is a single linear `POST` handler with
**zero behavioural test coverage**. It fuses a thin HTTP shell with the deep
server-side execution of one **Chat turn**: ~30 mutable per-request `let` cells
shared across **two** streaming layers (the `streamText` callbacks and the
`toUIMessageStreamResponse` envelope), plus a durable-persistence state machine
smeared across ~10 callback sites and two helper factories
(`app/api/chat/durable-runtime.ts`).

A verified read-through established two facts the code forces, which rule out the
naïve `run(turn) → stream` shape:

1. **There is a synchronous PREPARE phase that throws HTTP-mappable errors before
   any model call** — auth-resolved model/key resolution, key preflight (401),
   Tool runtime construction, durable-prepare (the optimistic-concurrency guard
   + `prepareGeneration`, which can reject with a 4xx), history adaptation, and
   request shaping. A single `run()` would force these into the response stream,
   losing the status codes (clients get a 500 or a 200-with-error-stream).

2. **`streamText()` returns a result handle synchronously while generation runs
   in the background** (`route.ts:1088`, wrapped at `1527`). The seam can only
   fall at that handle — never at a finished value or a fully-built `Response`.

The fragile, untested heart is the **cross-callback handoff**:
`durableFinalUsage` / `durableFinalFinishReason` / `durableFinalToolCounts` are
written in the `streamText` `onFinish` and read in the *response-level*
`onFinish` (`markGenerationRunCompleted`). If those two `onFinish` bodies are
split across a seam, the handoff silently breaks — completion falls back to
`countToolParts(responseMessage)` and **masks the bug** rather than failing
loudly. The deletion test confirms the core earns extraction: deleting the
orchestration does not vanish — it reappears as ~16 behaviours reachable only by
issuing a real HTTP request against a live model.

## Decision

Introduce the **Chat turn runtime** (`CONTEXT.md`): the single server-side module
that executes one Chat turn for one request, prepared once and alive for the
whole stream. `route.ts` becomes a thin HTTP adapter — parse → prepare → respond.

The interface is **two-phase**, following the codebase's factory pattern
(`prepareToolRuntime`, `create*`):

```ts
createChatTurnRuntime({ input, deps? })   // input: the validated, admitted turn
                                          //   (messages, chatId, model, auth, …)
                                          // deps (injected, defaulted): streamText,
                                          //   fetchMutation, fetchQuery, after,
                                          //   getPostHogClient
  .prepare()          → Promise<void>      // builds the plan; may throw { statusCode, code }
  .toResponse(signal) → Response           // owns toUIMessageStreamResponse
  .fail(error)        → Promise<void>      // route's outer catch calls this
```

The runtime is **one-shot**: a `phase` guard rejects a second `prepare()` or
`toResponse()`, so a repeated call can never open a second durable run or model
stream. MCP cleanup (`dispose()`) is internal — registered via the injected
`after()` at prepare time and re-run idempotently by `fail()`; it is not part of
the public interface.

- **`prepare()`** resolves model/key, builds the Tool runtime, runs
  durable-prepare, adapts history, shapes the request, and throws status-coded
  errors the route maps via `createErrorResponse`. Holds the resulting plan
  internally (`PreparedTurn`: aiModel, provider, enrichedSystemPrompt,
  modelMessages, maxSteps, providerOptions, requestHeaders, braintrustMetadata,
  thresholds) plus the Tool runtime and durableRunState (+ snapshotTracker).
- **`toResponse(signal)`** invokes `streamText` inside `withBraintrustTrace`,
  owns the entire stream-lifecycle closure cluster and **both** `onFinish`
  layers in one closure (preserving the `durableFinal*` handoff), and returns the
  streaming `Response`. `consumeSseStream` is preserved so the `maxDuration=60`
  invocation stays alive until the completion write finishes.
- **The runtime owns the abort/stall telemetry** (`chat_client_abort` moves in),
  so `abortCaptured` / `streamCompleted` and the `streamText` `onAbort` share one
  closure and an abort single-counts. The route passes `req.signal` in and keeps
  no abort responsibility.
- **`fail(error)`** lets the route's outer catch finalize a failed run
  (`markGenerationRunFailed` + dispose) even when the stream never started, using
  the runtime-held convex token.

Internal seams (private to the implementation, used by its own tests): the Tool
runtime (composed, not exposed), `durable-runtime.ts`'s stateless helpers (the
runtime's internal vocabulary) and its two stateful factories (lifecycle owned by
the runtime), `adaptHistoryForProvider` / `shapeRequest`, the outcome sinks, the
abort/stall watchdog, and the injected `streamText` / `fetchMutation` / `after`.

The route keeps only HTTP concerns: `POST` signature + `maxDuration`,
`req.json()` parse, cookie→`convexToken`, usage admission control (a pre-runtime
gate), the 400/401 validation short-circuits, and returning the `Response`.

### Rejected alternatives (do not relitigate)

- **`run(turn) → stream` (single phase).** Collapses the prepare/stream
  ownership and failure-mode boundary; loses HTTP status codes on prepare errors.
- **Naming it a "session."** Collides with the client `ChatSessionProvider` and
  the WorkOS auth session. "Runtime" reuses the established
  *"X runtime = everything a request needs for X, prepared once, alive for the
  stream"* pattern (Tool runtime) and composes the Tool runtime cleanly.
- **Route keeps `toUIMessageStreamResponse` / its own abort listener.** Forces
  the route to hold runtime internals (`durableFinal*`, `approvalWritePromises`)
  as callbacks and risks double-counting aborts across two listeners.

## Consequences

- The Chat turn runtime's interface becomes the test surface: `prepare()`
  success/throw with status codes, the dual abort/finish dedupe, the
  `durableFinal*` handoff, the stalled-continuation watchdog (fake timers), and
  the `streamText` config args become unit-testable with `streamText` and
  `fetchMutation` injected — without an HTTP request or a live model. Per the
  lean-test preference, new coverage concentrates on the `durableFinal*` handoff,
  the abort/finish dedupe, and prepare-throw mapping — not one test per telemetry
  field.
- The four existing test files (`durable-runtime`, `utils`, `search-tools`,
  `text-file-parts`) survive unchanged — they target helpers that become the
  runtime's internal building blocks. The brittle `readFileSync` source-ordering
  assertion in `durable-runtime.test.ts:206` is deleted once `prepare()` gives
  the ordering a real unit test.
- **Deferred, not in this cut:** the OpenAI plaintext-fallback
  (`route.ts:863` hard-codes `provider === "openai"`) moves behind the runtime
  as-is for now; pushing it behind an adapter post-convert hook is a separate
  refactor (detection runs on post-convert `ModelMessage[]`, rebuild on
  pre-convert `UIMessage[]` — both forms must move together).
- **Must verify during implementation (flagged risks):** (a) the Braintrust span
  outlives the synchronous wrapper return for the async `onFinish` logging;
  (b) session-registered `after()` cleanup does not reorder flush-before-write
  against the catch-path durable writes; (c) the edit/regen optimistic-concurrency
  guard (`expectedVisibleMessageCount` / `tailMessageId`) is relocated verbatim —
  it is the area with the known version-guard count-drift edge.
