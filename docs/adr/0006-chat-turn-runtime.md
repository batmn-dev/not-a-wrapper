# 6. The chat route is a thin HTTP adapter over a deep Chat turn runtime

- Status: accepted
- Date: 2026-06-26
- Context: Architecture deepening — chat request path; branch `darknight/crime-alley`
- Related: ADR-0003 (authenticated handler seam — the same "make a re-derived
  orchestration structural" move on the Convex side)

## Context

The original `app/api/chat/route.ts` fused its HTTP shell with the complete
server-side execution of one **Chat turn**. Model preparation, durable state,
stream callbacks, and response settlement shared mutable request state, making
their ordering difficult to test or preserve while changing the route.

A verified read-through established two facts the code forces, which rule out the
naïve `run(turn) → stream` shape:

1. **There is a pre-stream PREPARE phase that throws HTTP-mappable errors before
   any model call** — auth-resolved model/key resolution, key preflight (401),
   Tool runtime construction, durable-prepare (the optimistic-concurrency guard
   - `prepareGeneration`, which can reject with a 4xx), history adaptation, and
     request shaping. A single `run()` would force these into the response stream,
     losing the status codes (clients get a 500 or a 200-with-error-stream).

2. **`streamText()` returns a result handle while generation continues in the
   background.** The runtime boundary must therefore live for the whole stream,
   not end at a finished value or prebuilt `Response`.

The fragile heart is the **cross-callback handoff**:
the provider-level `onEnd` captures final usage, finish reason, and tool counts
through `lifecycle.stream.captureFinish(...)`; the response-level `onEnd` later
passes the completed response to `lifecycle.envelope.settle(...)`. Those two
callbacks must share one lifecycle owner so settlement receives the captured
provider facts.

## Decision

Introduce the **Chat turn runtime** (`CONTEXT.md`): the single server-side module
that executes one Chat turn for one request, prepared once and alive for the
whole stream. `route.ts` becomes a thin HTTP adapter — parse → prepare → respond.

The interface is **two-phase**, following the codebase's factory pattern
(`prepareToolRuntime`, `create*`):

```ts
createChatTurnRuntime({ input, deps? })
  .prepare()          → Promise<void>
  .toResponse(signal) → Promise<Response>
  .fail(error)        → Promise<void>
```

The runtime is **one-shot**: a `phase` guard rejects a second `prepare()` or
`toResponse()`, so a repeated call can never open a second durable run or model
stream. MCP cleanup (`dispose()`) is internal — registered via the injected
`after()` at prepare time and re-run idempotently by `fail()`; it is not part of
the public interface.

- **`prepare()`** resolves credentials and model configuration, builds the Tool
  and Durable turn runtimes, prepares durable state, adapts history, and shapes
  the provider request. It may still throw status-coded errors before streaming.
- **`toResponse(signal)`** owns `streamText`, both `onEnd` layers, abort and
  stall handling, and the response stream. The provider result and durable
  settlement facts therefore stay inside one closure.
- **`fail(error)`** finalizes a prepared durable run when the request fails
  before the stream can settle it.

The route keeps HTTP concerns: parsing and validating the request, resolving
session context, mapping expected failures to responses, and handing the request
signal to the runtime.

### Rejected alternatives (do not relitigate)

- **`run(turn) → stream` (single phase).** Collapses the prepare/stream
  ownership and failure-mode boundary; loses HTTP status codes on prepare errors.
- **Naming it a "session."** Collides with the client `ChatSessionProvider` and
  the WorkOS auth session. "Runtime" reuses the established
  _"X runtime = everything a request needs for X, prepared once, alive for the
  stream"_ pattern (Tool runtime) and composes the Tool runtime cleanly.
- **Route keeps the UI-message stream envelope / its own abort listener.** Forces
  the route to hold lifecycle state as callbacks and risks double-counting
  aborts across two listeners.

## Consequences

- The runtime interface is the test surface for prepare failures, one-shot
  ownership, abort/finish deduplication, provider configuration, and durable
  completion handoff without a live model.
- Lifecycle and persistence ordering stay inside the runtime rather than being
  re-created in the route or asserted by reading source text.
