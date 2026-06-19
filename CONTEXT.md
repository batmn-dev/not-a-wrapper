# Not A Wrapper

Domain language for the multi-AI chat app: one chat surface, many model providers, with tools layered on top of every conversation.

## Language

### Chat

**Chat turn**:
One user action that changes a conversation and may produce an assistant response, including a new message, a suggestion send, a regeneration, or an edit that truncates later messages before continuing.
_Avoid_: submission, send flow, message lifecycle

### Tools

**Tool runtime**:
Everything a chat request needs to use tools, prepared once per request and alive for the whole stream: the merged tool set, per-tool metadata, step gating, budget accounting, and tool outcome recording.
_Avoid_: tool coordinator, tool orchestrator, tool loader

**Tool layer**:
One of the sources tools come from — Layer 1 (provider-native), Layer 2 (Exa search/content fallback), Layer 3 (user-configured MCP servers). Layers are merged into the tool runtime; later layers win name collisions.
_Avoid_: tool source (reserved for the per-tool metadata field), tier

**Capability policy**:
The per-request decision of which tool capabilities (search, extract, mcp, code) a user/model/key combination may use, and which specific tools are allowed in early vs late steps.
_Avoid_: permissions, feature flags

**Tool budget**:
The per-tool call allowance enforced during a request — probed before provider-executed calls, consumed after execution, degrading to a request-local soft cap when the policy store is unreachable.
_Avoid_: rate limit, quota

**Tool outcome**:
One record per tool call — tool identity and display name, source, success, duration, error, budget fields, input/output previews, token usage — assembled by the tool runtime when the call's step finishes and pushed through outcome sinks injected at preparation (audit log, analytics, trace log). Every call produces an outcome, including failures and tools the runtime cannot identify; errors are recorded for all sources. The runtime accumulates outcomes and exposes a request-level summary.
_Avoid_: tool call log entry (that's one sink's projection), tool trace (reserved for the in-flight timing/error data the outcome consumes), tool result (reserved for the provider's result payload)

### Models

**Request shaping**:
Everything provider-specific about issuing one model request, resolved from the model config plus request context (active search tools, tool presence): provider options such as thinking/reasoning configuration, per-model thinking budgets, and provider beta headers. Owns provider-workaround invariants (e.g. SDK pause_turn downgrades) so callers never branch on provider.
_Avoid_: provider options (reserved for the AI SDK field it produces), model tuning
