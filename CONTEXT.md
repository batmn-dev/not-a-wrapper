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

### Client

**Per-user subscription**:
The single client seam — a `usePerUserQuery` hook — every per-user Convex live read goes through. It owns the one correct subscribe gate, `isConvexAuthenticated` (the Convex JWT is synced), not WorkOS session presence (`!!user` / `!!userId`), and returns `"skip"` until it is true, so a signed-out or mid-auth-sync caller never opens a subscription or executes a wrong-empty read against a not-yet-resolved identity. It is the client counterpart to the **Authenticated handler**: the subscribe gate becomes structural instead of an `isAuthenticated ? {} : "skip"` ternary each call site re-derives with a different predicate (and which `userKeys.getProviderStatus` forgot entirely). Public/share-link reads go through a sibling `usePublicQuery` passthrough, and a `no-restricted-imports` rule bans raw `useQuery` from `convex/react`, so every call site declares per-user vs public — the same `maybeAuthQuery`-vs-`query` choice the backend makes. The hook returns auth-readiness alongside the data so providers stop re-deriving `data === undefined && authState` loading logic by hand.
_Avoid_: skip gate, auth ternary, guarded query

### Chat

**Chat turn**:
One user action that changes a conversation and may produce an assistant response: a new message, a suggestion send, a regeneration, or an edit. Edit and regeneration are server-owned variants — the backend creates a message branch and derives the new selected path — and may target any prior message, so they require a durable (authenticated, server-persisted) chat. Guest/local chats are send-only.
_Avoid_: submission, send flow, message lifecycle

**Chat turn runtime**:
The single server-side module that executes one **Chat turn** for one HTTP request, prepared once and alive for the whole stream — the backend counterpart to the client-side Chat turn, and the deep module the chat route (`app/api/chat/route.ts`) is a thin HTTP adapter over. Two-phase. `prepare()` resolves model/key, builds the **Tool runtime**, runs durable-prepare (the optimistic-concurrency guard plus generation-run creation), adapts history (**Provider strategy** sibling seams) and shapes the request, and throws status-coded errors — missing key → 401, durable concurrency → 4xx — that the route maps to HTTP responses *before any model call*. `toResponse(signal)` invokes `streamText`, owns the stream-lifecycle state and **both** `onFinish` layers (the `streamText` callback and the `toUIMessageStreamResponse` envelope share one closure — the `durableFinal*` usage/finishReason/toolCounts handoff that drives `markGenerationRunCompleted`; splitting them silently falls back to `countToolParts` and masks the bug), and returns the streaming Response. It owns the durable-persistence timeline (snapshot throttling, tool-invocation upserts, approval-request backpressure, completion/abort/failure transitions) and the abort/stall telemetry in one closure so an abort single-counts; `fail(error)` lets the route's outer catch finalize a failed run even when the stream never started. The convex token crosses once at construction; the abort signal crosses into `toResponse`; `after()` crosses as an injected registrar. The Tool runtime is an internal seam it composes, not part of its interface. The route keeps only HTTP concerns: parse, cookie→token, usage admission, validation 400/401, and returning the Response. See `docs/adr/0006-chat-turn-runtime.md`.
_Avoid_: chat handler, stream pipeline, request orchestrator (too vague); session (collides with the client `ChatSessionProvider` and the WorkOS auth session); Tool runtime (that is the composed sub-module, not this)

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
The single client module (`lib/chat-messages/metadata.ts`) that owns message `metadata`: one private set of server-owned keys, the `isRecord` guard, and the typed readers/writers (`getServerMessageId`, `getBranch`, `stampServerFields`, `adoptServerOwned`) every caller goes through instead of casting `metadata as Record<string, unknown>` and hand-poking keys. The durable adapter and the branch projection call its writers; renderers call its readers. The streamed assistant-metadata blob is projected through a named validator (`vToolInvocationStreamMetadata`, `convex/lib/messageMetadata.ts`) at the persist boundary so only the owned key-set is written and malformed writes are rejected; the storage column (`messages.metadata`) is narrowed to that same validator so the stored shape is provably the owned key-set, not an opaque `v.any()`. Branch stays a transient, droppable descriptor; the writers preserve reference identity on no-op (the projection's idempotence contract) and pass client-transient keys (e.g. `reasoningDurationMs`) through untouched.
_Avoid_: metadata bag, ad-hoc cast, `metadata as Record`

**Selected path token**:
The forward (client→server) staleness guard for a chat turn — a `{ expectedVisibleMessageCount, tailMessageId? }` descriptor the client derives from the rendered selected path and sends with a new-message turn; the backend validates it before mutating and rejects a turn raced against a changed selected path. It is the counterpart to the branch projection (the backward, server→client half) and is unrelated to it despite the shared name; edits and regenerations carry their own count guard (`expectedChatVersion`) instead of the token.
_Avoid_: conflating with branch projection (that's the backward half), version (overloaded)

**Chat list window**:
The bounded, recency-ordered slice of a user's chats the **sidebar** subscribes to — a `usePaginatedQuery` of **non-pinned, non-project** chats over the composite `by_user_pinned_project_updated` index (`getRecentWindowForCurrentUser`), plus a small live pinned read (`by_user_pinned`), behind `ENABLE_PAGINATED_SIDEBAR` (ADR-0005). Pinned/project chats are excluded at the index level so they never consume a window slot. It is deliberately NOT the full chat list: a chat write invalidates only the window, not the whole `by_user` collection. The client `useChats()` store narrows to this window; the id-keyed optimistic overlay applies to it, so an op on a chat outside the window is a no-op in the sidebar (the surface that shows that chat reflects it via its own read). `isLoading` from the store means "first window page ready," not "all chats loaded." Per-chat access outside the window goes through `useChat(chatId)` (a targeted `chats.getById` fallback), and `chats.updatedAt` is the single activity field the window orders by — one bump per durable turn, at turn start.
_Avoid_: the full chat list, `getForCurrentUser` as the sidebar source (that is the pre-ADR-0005 unbounded read), recent chats (ambiguous)

**History search**:
Full-history reach that does NOT go through the **chat list window** — the surfaces that must see chats outside the bounded sidebar, each on its own on-demand read: title search (`chats.searchByTitle` over a `by_title` search index, subscribed only while the search UI is open, behind a `SearchProvider` that exposes `query → results`), browse-all (a paginated non-project `by_user_project_updated` read in the history drawer, because project chats are hidden while browsing), the project view (`getProjectChatsForCurrentUser` over `by_project`), and deep-links (`useChat` → `chats.getById`). Search is title-only by design and still reaches project chats; message-content search would be a separate index on `messages`. These reads are what make bounding the sidebar safe — they each own full-history access rather than borrowing the sidebar's list.
_Avoid_: searching the sidebar window (it is bounded; search must hit its own server read), the full array (the search provider exposes results, never the corpus)

**Assistant turn view**:
The single pure derivation of everything renderers need from one assistant message — text, attachments, tool parts and their render signature, sources, image-search results, and the reasoning phase (idle/thinking/complete, text, opacity, persisted duration read via the **Message metadata module**). Derived per render in Conversation's map loop, never memoized by `parts` reference (the AI SDK mutates part objects in place during streaming), and consumed by the message row, the activity trigger, and the **Activity panel** alike — so "is this message thinking?" and "thought for N seconds" have exactly one derivation instead of a trigger-path and a panel-path that can disagree. The live thinking timer is the one stateful remainder (a thin hook consuming the view). Renderers compare the view's precomputed signature strings in memo comparators instead of re-extracting from raw parts.
_Avoid_: per-renderer part extraction (`parts?.some(...)` in components), raw `metadata.reasoningDurationMs` / `metadata.toolMetadataByName` reads (go through the metadata module's readers), view model (Reactism)
_Status_: implemented 2026-07-03 (branch `darknight/gotham-by-gaslight`).

**Activity panel**:
The Chat-hosted module behind the single activity surface (reasoning, sources, tool steps) — one panel instance, one open state, one projected turn. Assistant rows reach it through a store seam with per-row selectors (`isPanelTurn(messageId)`-shaped reads) and stable action identities (`openTurn`, `close`), not via a controls object threaded Chat → Conversation → Message → MessageAssistant. The explicit-vs-default turn classification (`selectExplicitActivityTurnOnOpen`) resolves inside the store at call time from current state — never from a closure captured at render time, the stale-closure class that the prop thread invited. A panel handoff re-renders only the two affected rows (old and new panel turn), and the scroll-anchoring release on open stays internal to the module. The pure target selector (`selectActivityPanelTarget`) and its tests survive as the selection brain.
_Avoid_: `activityPanel` prop threading, controls-object forwarding, re-deriving `isPanelTurn` in rows, memo comparators peeking into panel fields
_Status_: implemented 2026-07-03 (branch `darknight/gotham-by-gaslight`).

**Turn context**:
The per-chat client module owning the inputs every **Chat turn** kind needs at run time: selected model (chat model → last-used → favorite → tier default resolution, override cleared on chat navigation), web-search enablement, and system prompt. Turn runners (send, suggestion send, edit, regeneration) read it through an imperative snapshot getter at run time — not through closure-captured values that go stale between render and submit (the `?prompt=` auto-submit-before-hydration wrong-model case). The **Composer** renders the model picker and search toggle as writers of this module; edit and regeneration consume the same snapshot, which is why the module is chat-level, not composer-private. Snapshot exposes hydration readiness so auto-submit can wait.
_Avoid_: closure-captured model/search in submit callbacks, three-layer model ownership (hook logic + Chat orchestration + input pass-through), composer-owned model (edits/regens need it too)
_Status_: implemented 2026-07-03 (branch `darknight/gotham-by-gaslight`).

**Composer**:
The deep client module that assembles a **Chat turn** payload: it owns the draft (per-chat persistence and clearing), attachment files, suggestion UI, paste/drop capture, and the primary action, and emits one complete payload (`text`, `files`) through a single `onTurn` interface — Chat decides when and how to run the turn. External commands come through a small imperative handle (`insertQuote`, `setText`, `focus`) instead of command-as-state props (`quotedText`) and listener-registration plumbing. It reads auth from the user store and model/search from the **Turn context** directly, so the parent stops threading orchestration props (the 21-prop interface and its 18-dependency memo dissolve).
_Avoid_: chat-input prop orchestration (the shallow 21-prop interface), parent-owned draft/file state, `quotedText`-style commands modeled as state
_Status_: implemented 2026-07-03 (branch `darknight/gotham-by-gaslight`).

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
