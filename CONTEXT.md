# Not A Wrapper

Domain language for the multi-AI chat app: one chat surface, many model providers, with tools layered on top of every conversation.

## Language

### Backend

**Convex module**:
The single server-side Convex source tree at `convex/`, including schema, functions, migrations, generated bindings, and Convex-domain tests. UI and component folders may import the root module's generated API, but must not contain copied Convex source trees.
_Avoid_: server copy, UI Convex mirror, `components/ui/convex`

**Authenticated handler**:
A Convex `query`/`mutation` defined through an auth-injecting builder (`authenticatedQuery`, `ownedChatMutation`, `ownedProjectMutation`, `ownedMcpServerMutation`, …) instead of calling `ctx.auth.getUserIdentity()` inline. The builder resolves the caller's user — and, for owned-resource variants, fetches and ownership-checks the resource — before the handler body runs, injecting `ctx.user` (and `ctx.chat`/`ctx.project`/…) and enforcing one error contract (Not authenticated → not found → Not authorized). It makes auth structural, not a call you must remember. Internal functions and the HTTP chat-route token path stay outside the seam; public-only reads (share links) and anonymous/optional-auth paths use their own non-throwing builders. Self-identity-match handlers (`identity.subject === arg`) are a distinct shape, not an owned-resource one.
_Avoid_: auth helper (the older bypassable `lib/auth.ts` form), middleware, guard

### Chat

**Chat turn**:
One user action that changes a conversation and may produce an assistant response: a new message, a suggestion send, a regeneration, or an edit. Edit and regeneration are server-owned variants — the backend creates a message branch and derives the new selected path — and may target any prior message, so they require a durable (authenticated, server-persisted) chat. Guest/local chats are send-only.
_Avoid_: submission, send flow, message lifecycle

**Message branch**:
A sibling message alternative under the same parent message, created by durable edits and regenerations so prior turns remain addressable instead of being overwritten or deleted.
_Avoid_: fork (too broad), version (too overloaded)

**Selected path**:
The backend-derived linear path through a chat's message branches used for rendering and model history. Hidden sibling branches stay stored but are not sent to the model until selected.
_Avoid_: visible messages, active transcript

**Branch projection**:
The single client seam that installs the backend's selected path into the AI SDK's flat `useChat` array while a chat is idle: it adopts server ids and branch state onto matching live messages, preserves in-flight optimistic sends, and swaps wholesale when the path diverged (a branch switch, or restoring messages a rejected edit/regeneration sliced out). It is the sole owner of client identity adoption — matching by message identity across the full selected path (not a positional tail patch) and reading server ids through one typed accessor (`readServerMessageId` in `lib/chat-messages/branch.ts`). The client renders the server's selected path; it does not re-derive it. See `docs/adr/0001-client-renders-server-selected-path.md`.
_Avoid_: reconcile (too narrow — that's only the id-adoption half), rehydrate, sync

**Message metadata module**:
The single client module (`lib/chat-messages/metadata.ts`) that owns message `metadata`: one private set of server-owned keys, the `isRecord` guard, and the typed readers/writers (`getServerMessageId`, `getBranch`, `stampServerFields`, `adoptServerOwned`) every caller goes through instead of casting `metadata as Record<string, unknown>` and hand-poking keys. The durable adapter and the branch projection call its writers; renderers call its readers. The streamed assistant-metadata blob is projected through a named validator (`vToolInvocationStreamMetadata`, `convex/lib/messageMetadata.ts`) at the persist boundary so only the owned key-set is written and malformed writes are rejected; the storage column stays `v.optional(v.any())` because the repo's expand/migrate/contract tooling guards field removals, not validator narrowings. Branch stays a transient, droppable descriptor; the writers preserve reference identity on no-op (the projection's idempotence contract) and pass client-transient keys (e.g. `reasoningDurationMs`) through untouched.
_Avoid_: metadata bag, ad-hoc cast, `metadata as Record`

**Selected path token**:
The forward (client→server) staleness guard for a chat turn — a `{ expectedVisibleMessageCount, tailMessageId? }` descriptor the client derives from the rendered selected path and sends with a new-message turn; the backend validates it before mutating and rejects a turn raced against a changed selected path. It is the counterpart to the branch projection (the backward, server→client half) and is unrelated to it despite the shared name; edits and regenerations carry their own count guard (`expectedChatVersion`) instead of the token.
_Avoid_: conflating with branch projection (that's the backward half), version (overloaded)

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

**Provider strategy**:
The single home for everything statically true about one model provider's AI SDK: how to instantiate its client (a BYOK key vs the provider's default/env credentials), its optional native built-in search tool plus that tool's display metadata, and its platform API-key environment-variable name. Stateless; one per provider, behind a registry keyed by `getProviderForModel` (`lib/openproviders/provider-strategy.ts`). The same instance backs both the language model and the search tool, so tool calls structurally bill to the same key as the model — the BYOK billing invariant is no longer a hand-synced convention split across the model factory and the tool factory. `languageModel` is synchronous (the registry is statically constructed; provider SDKs are eagerly imported, because model construction must return a non-Promise `LanguageModelV3`). It deliberately excludes anything that is not a static SDK fact: routing (`getProviderForModel` is the selector that reads catalog membership, which the strategy does not own), key selection/precedence (the strategy declares only the env-var name; `getEffectiveApiKey` consumes it), request shaping (per-model request policy — stays a free function), and history adaptation (a sibling seam with a different, non-1:1 taxonomy). OpenRouter is the documented irregular — self-resolved env, `.chat()`, `openrouter:` prefix strip, no native search — with every divergence body-internal so the shared interface never widens.
_Avoid_: provider wrapper, provider factory (too narrow — that is only `languageModel`), provider adapter (reserved — the history-replay adapters are a different seam)

**Request shaping**:
Everything provider-specific about issuing one model request, resolved from the model config plus request context (active search tools, tool presence): provider options such as thinking/reasoning configuration, per-model thinking budgets, and provider beta headers. Owns provider-workaround invariants (e.g. SDK pause_turn downgrades) so callers never branch on provider. Stays a free function keyed by `providerId`, deliberately outside the **Provider strategy**: its variation is per-model and per-request (the reasoning-text gate, the search-active thinking downgrade, the token-efficient header), not a static provider fact.
_Avoid_: provider options (reserved for the AI SDK field it produces), model tuning
