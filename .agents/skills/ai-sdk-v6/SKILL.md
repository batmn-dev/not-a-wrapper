---
name: ai-sdk-v7
description: Implement Vercel AI SDK v7 features correctly in this repo (streamText, UI message streams, tool calling and approvals, reasoning control, Output object, async message conversion). Use when building or updating AI routes or chat flows with AI SDK v7.
---

# AI SDK v7 (Vercel) Implementation

Use this skill when adding or updating AI SDK v7 usage in `app/api/` routes or chat UI flows.

The repository currently resolves `ai@7.0.15`, `@ai-sdk/react@4.0.16`,
`@ai-sdk/provider@4.0.2`, first-party provider packages on major 4, and
`@openrouter/ai-sdk-provider@2.10.0`. OpenRouter still exposes a V3 model and
declares an `ai@6` peer; this repo accepts it through AI SDK 7's V3 compatibility
surface. Treat `package.json`, `bun.lock`, and installed package types as the
version source of truth. The directory name is a legacy path retained to avoid
deleting or renaming a user-owned skill directory during the documentation
refresh.

## Prerequisites

- [ ] You know whether this is server (route handler) or client (UI) work.
- [ ] You can reference the existing patterns in `app/api/chat/route.ts` and `app/components/chat/use-chat-core.ts`.

## Quick Reference

| Area               | Default Pattern                                                                    |
| ------------------ | ---------------------------------------------------------------------------------- |
| Server streaming   | `streamText(...)` → standalone `toUIMessageStream(...)` → response helper          |
| Message conversion | `await convertToModelMessages(...)`                                                |
| Structured output  | `generateText`/`streamText` with `output: Output.object({...})`                    |
| Tool calling       | `tools: { name: tool({ inputSchema, execute, strict }) }`                          |
| Tool approvals     | Central `toolApproval` policy or tool-level `needsApproval`                        |
| Reasoning control  | Normalized `reasoning`, including `"provider-default"` and supported effort levels |
| Runtime safety     | `timeout` as milliseconds or a scoped timeout object                               |
| Client UI          | `useChat` from `@ai-sdk/react`                                                     |
| Stream protocol    | `x-vercel-ai-ui-message-stream: v1`                                                |

## Step-by-Step Checklist (Server)

1. **Validate input + auth**

- [ ] Validate request body and required params.
- [ ] Apply rate limiting **before** `streamText()`.
- [ ] Use repo auth patterns if touching user data.

2. **Convert messages**

- [ ] Convert UI messages with `await convertToModelMessages(...)`.
- [ ] Use `ModelMessage`; the legacy `CoreMessage` type is no longer exported.

3. **Call the model**

- [ ] Use `streamText({ model, messages, tools, output, ... })`.
- [ ] Add tool definitions with `tool({ description, inputSchema, execute })`.
      Enable `strict: true` only when the target provider/model supports strict
      tool calling and the schema fits that provider's supported subset.
- [ ] Prefer call-site `toolApproval` on `streamText`, `generateText`, or
      `ToolLoopAgent` when approval policy belongs to the runtime. Tool-level
      `needsApproval` remains supported for static or input-dependent policy;
      if both apply, an approval requirement from either surface wins.
- [ ] Remember that `toolApproval` covers tools executed by the AI SDK, not
      provider-executed tools; apply provider-specific controls where needed.
- [ ] Use `contextSchema`/`toolsContext` to scope non-model inputs such as API
      keys to only the tools that need them.
- [ ] Use `runtimeContext` for typed state that must flow through agent steps.
- [ ] Set appropriate timeouts for long-running or higher-risk flows. AI SDK v7
      accepts a millisecond number or an object with `totalMs`, `stepMs`, and
      streaming-only `chunkMs`, plus a default `toolMs` and typed per-tool
      overrides under `tools`.
- [ ] For structured data, use `output: Output.object({ schema, name, description })`.

4. **Return the UI stream**

- [ ] Convert `result.stream` with standalone `toUIMessageStream`; pass the raw
      stream plus `sendReasoning`, `sendSources`, `onError`, and any persistence
      identity options.
- [ ] Wrap the converted stream with `createUIMessageStreamResponse({ stream })`.
- [ ] Do not add new uses of deprecated instance helpers
      `result.toUIMessageStream(...)` or
      `result.toUIMessageStreamResponse(...)`; both are removed in the next
      major release.
- [ ] Ensure the stream protocol header is `x-vercel-ai-ui-message-stream: v1`.

## Step-by-Step Checklist (Client)

1. **Chat UI**

- [ ] Use `useChat` from `@ai-sdk/react` (transport-based, default `/api/chat`).
- [ ] Keep UI message state consistent with the server stream protocol.

2. **Tools + approvals**

- [ ] Use `addToolOutput` for tool results.
- [ ] Use `addToolApprovalResponse` for approval flows.

3. **Custom streaming**

- [ ] For manual stream parsing, use `readUIMessageStream(...)`.
- [ ] Match the server’s stream protocol and message parts.

## Client Streaming Internals (Gotchas)

The installed AI SDK v7 streaming pipeline mutates message part objects **in place** during streaming. This creates a subtle React memoization trap.

### Mutation Flow

Inside `processUIMessageStream`, each delta chunk mutates the part object that was already pushed into `state.message.parts` by reference:

```typescript
// reasoning-delta (same pattern for text-delta)
reasoningPart.text += chunk.delta // mutates the object already in parts[]
write() // flushes to React state
```

### pushMessage vs replaceMessage Asymmetry

| Call                      | When                                                    | Clone behavior                                                           |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pushMessage(message)`    | First `write()` — streaming message ID not yet in state | **No clone** — uses `.concat(message)`, leaks the mutable working object |
| `replaceMessage(message)` | Subsequent `write()` calls — ID matches last message    | **structuredClone** — deep clone for React Compiler compatibility        |

The first `pushMessage` leaks the SDK’s mutable working object into React state. Subsequent stream mutations retroactively modify the object already held as “previous props” by React.

### Impact on React.memo / React Compiler

Any comparator reading `prev.parts[N].text` sees the **already-mutated** value (identical to `next.parts[N].text`) because both references point to the same object. The comparison always returns `true` (equal), so React skips re-renders during streaming.

### Safe Patterns

- [ ] **Derive scalar/render facts on every render** — this repo derives an
      `AssistantTurnView` from the current parts in
      `lib/chat-messages/assistant-turn.ts`; do not memoize that derivation by
      `parts` array identity.
- [ ] **Compare derived snapshots, not mutable parts** —
      `assistantTurnViewsEqual` is the row render gate. It compares values that
      were captured during separate renders rather than re-reading the same
      mutable part objects through `prev` and `next`.
- [ ] **Snapshot explicitly when needed** — capture scalar values during render
      (or in a ref) if another component needs a stable previous value.

## Do / Don’t (Repo-Specific)

**Do**

- Use standalone `toUIMessageStream({ stream: result.stream, ... })`, then
  `createUIMessageStreamResponse({ stream })`, for streaming chat responses.
- Use `Output.object(...)` for structured data.
- Await `convertToModelMessages(...)`.
- Use the normalized `reasoning` option when provider-agnostic effort control is
  desired and supported by the selected provider/model; use provider options
  for provider-specific behavior.
- Use call-site `toolApproval` when the runtime owns policy; use tool-level
  `needsApproval` when the policy belongs to the tool definition.
- Follow `app/api/chat/route.ts` for the HTTP boundary and
  `app/api/chat/chat-turn-runtime.ts` for the streaming lifecycle. The latter
  still contains a deprecated instance `result.toUIMessageStream(...)` call;
  do not copy that call into new code.
- Keep tool schemas validated and compatible with the selected provider/model.

**Don’t**

- Don’t add new uses of deprecated `generateObject` or `streamObject`; they are
  still exported in v7 but should be replaced with `generateText`/`streamText`
  plus `output`.
- Don’t add new uses of deprecated `StreamTextResult` instance stream helpers.
- Don’t return raw `ReadableStream` without UI message stream helpers.
- Don’t skip the rate limit check before `streamText()`.
- Don’t use the removed legacy `CoreMessage` type.

## Internal References

- HTTP route: `app/api/chat/route.ts`
- Server streaming lifecycle: `app/api/chat/chat-turn-runtime.ts`
- Client chat flow: `app/components/chat/use-chat-core.ts`
- Project rules: `AGENTS.md`

## Official Docs (AI SDK v7)

- Foundations overview: https://ai-sdk.dev/docs/foundations/overview
- AI SDK 7 announcement and migration command: https://vercel.com/blog/ai-sdk-7
- Generating & streaming text: https://ai-sdk.dev/docs/ai-sdk-core/generating-text
- `streamText` reference: https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
- Structured data with Output: https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
- Reasoning: https://ai-sdk.dev/docs/ai-sdk-core/reasoning
- Tools & tool calling: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- Runtime and tool context: https://ai-sdk.dev/docs/ai-sdk-core/runtime-and-tool-context
- Agent tool approvals: https://ai-sdk.dev/docs/agents/tool-approvals
- Core tool execution approval: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling#tool-execution-approval
- Settings and timeouts: https://ai-sdk.dev/docs/ai-sdk-core/settings
- UI stream protocol: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
- Reading UI message streams: https://ai-sdk.dev/docs/ai-sdk-ui/reading-ui-message-streams
- `convertToModelMessages`: https://ai-sdk.dev/docs/reference/ai-sdk-ui/convert-to-model-messages
- `useChat` reference: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat

For v7-only behavior such as normalized reasoning, tool/runtime context,
approval policy, and tool timeouts, use the linked v7 pages and cross-check the
installed `ai@7.0.15` types/source instead of extrapolating from older migration
guides or cached search snippets.

For a v6-to-v7 code migration, Vercel recommends
`npx @ai-sdk/codemod v7`. Review every generated change against the installed
types and this repo's streaming/persistence invariants before accepting it.
