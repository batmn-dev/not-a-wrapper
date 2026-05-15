# Braintrust Observability Integration

## Docs Reviewed

- Braintrust documentation index: https://www.braintrust.dev/docs/llms.txt
- Vercel AI SDK integration: https://www.braintrust.dev/docs/integrations/sdk-integrations/vercel
- Trace application logic: https://www.braintrust.dev/docs/instrument/trace-application-logic
- Trace LLM calls: https://www.braintrust.dev/docs/instrument/trace-llm-calls
- Advanced tracing: https://www.braintrust.dev/docs/instrument/advanced-tracing
- User feedback: https://www.braintrust.dev/docs/instrument/user-feedback
- Evaluation quickstart: https://www.braintrust.dev/docs/evaluation
- TypeScript SDK reference: https://www.braintrust.dev/docs/reference/sdks/typescript/3.4.0/typescript
- Changelog: https://www.braintrust.dev/docs/changelog

## Approach Decision

Chosen: Option B, a centralized server-only Braintrust helper wrapping selected Vercel AI SDK functions.

Option A, wrapping only the local `streamText` call inside `app/api/chat/route.ts`, would work but would mix Braintrust setup, privacy masking, and flushing into an already large route. Option C, OpenTelemetry or auto-instrumentation, adds Next/Turbopack and observability configuration surface area and is higher risk because this route already uses Sentry and PostHog.

The centralized helper keeps Braintrust provider-agnostic, preserves the existing AI SDK v6 streaming path, and leaves Sentry/PostHog behavior intact.

## Implementation Notes

- `lib/observability/braintrust.ts` lazily initializes Braintrust only when `BRAINTRUST_API_KEY` is present and `BRAINTRUST_ENABLED` is not false.
- The helper calls `initLogger`, installs a global masking function, wraps the AI SDK namespace with `wrapAISDK`, and exports a safe `getBraintrustStreamText()` accessor.
- `app/api/chat/route.ts` now gets `streamText` through that accessor and wraps the generation call in a parent `POST /api/chat` span using `traced`.
- The route still returns `result.toUIMessageStreamResponse({ sendReasoning: true, sendSources: true, onError })` and does not buffer the stream.
- `after()` flush hooks remain in place for PostHog and MCP cleanup, with a Braintrust flush added alongside them.

## Privacy Policy

Braintrust metadata is intentionally low-cardinality and content-free by default. The parent span includes request ID, route, hashed chat ID, model, provider, auth state, message count, chat version bucket, search/tool policy summary, tool counts, MCP server/tool counts, key mode, max steps, latency buckets, usage, finish reason, and error taxonomy.

The masking function redacts secret-like keys, likely API-key strings, chat inputs/outputs/messages, tool arguments, and tool results. `BRAINTRUST_LOG_CONTENT=true` enables scrubbed content logging, but secrets and common PII still pass through the scrubber. Raw BYOK keys, provider API keys, Clerk/Convex tokens, cookies, file contents, and tool credentials must not be logged.

## Follow-Ups

- Add Braintrust feedback once there is a message-level rating flow and a safe way to associate assistant messages with span IDs without Convex schema churn.
- Add evals after agreeing on dataset/evaluator conventions. A small smoke eval for chat quality or tool routing is the likely first step.
- Manually verify a Braintrust-enabled chat trace in a real environment with search and MCP tools configured.

## Validation Notes

- Focused helper tests cover disabled behavior, feature flag behavior, default redaction, safe metadata preservation, scrubbed content logging, and stable hashed IDs.
- Full validation should include `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run build:next` when the local environment allows.
