# Model Thinking States Research

Date: 2026-06-28
Status: research document (rev. 2 — incorporated an adversarial review pass: corrected the catalog/pipeline guard scope, pinned all SDK claims to `ai@6.0.78`, marked v7/out-of-catalog facts forward-looking, made the text-embedded safety boundary durable-first, and softened the Addendum from decisions to findings)
Scope: model thinking/reasoning capability, streaming semantics, durable chat lifecycle, and display eligibility in Not A Wrapper
Non-goal: this is not an implementation plan and does not prescribe sequencing

## Recommended Mental Model

Treat "thinking" as three separate facts that only sometimes overlap:

1. The model/request capability: whether the selected model can perform reasoning and whether reasoning is configurable for the provider/model route.
2. The occurrence evidence: whether this specific turn actually requested or observed reasoning through request policy, stream events, durable metadata, usage, or provider metadata.
3. The displayable content evidence: whether provider-returned reasoning content is user-safe summary/activity text, replay-only metadata, hidden occurrence, encrypted/opaque content, unknown content, or unsafe text-embedded/raw trace content.

The UI should not infer "Thinking" from a pending assistant response alone. It should render a thinking treatment only when the turn has an effective reasoning policy or observed reasoning evidence. It should render visible reasoning text only when the provider returns user-safe summary/activity content intended for display. Static model capability is an input to this decision, not proof that hidden reasoning happened and not proof that displayable reasoning content exists.

## Research Goals

- Identify the durable source of truth for model capability, stream evidence, assistant lifecycle, selected-path rendering, and activity-panel rendering.
- Distinguish hidden reasoning, displayable reasoning summaries, activity-like reasoning output, tool activity, source citations, and generic waiting.
- Capture edge states that an implementation plan must preserve: reloads, local chats, shared chats, branch switching, regeneration, aborts, failures, approvals, provider fallback, and historical schema drift.
- Record provider and AI SDK semantics from official docs so implementation work does not bake in false cross-provider assumptions.
- Surface open product and technical questions that should be resolved before writing a final implementation plan.

## Non-Goals

- This document does not choose an implementation sequence.
- This document does not introduce a migration plan.
- This document does not specify final component APIs.
- This document does not assert that the current activity-panel implementation is correct.
- This document does not approve displaying raw chain-of-thought.

## How To Read This Document

- **Findings vs decisions.** A *finding* describes what is true now or what is provably wrong; a *decision* chooses among open options. Findings can be stated plainly; decisions belong in Open Questions, not in declarative "must" form. If a sentence picks a field name, an API shape, or a sequence, it has crossed from research into planning and should be reworded or moved to Open Questions.
- **Pinned versions.** All SDK claims are pinned to this repo's lockfile: `ai@6.0.78`, `@ai-sdk/anthropic@3.0.41`, `@ai-sdk/google@3.0.24`, `@ai-sdk/openai@3.0.26`, `@ai-sdk/xai@3`, `@ai-sdk/perplexity@3.0.17`, `@ai-sdk/mistral@3`, `@openrouter/ai-sdk-provider@2`, `@ai-sdk/react@3.0.80`. A behavior verified only against `vercel/ai` `main` (the v7 line) is **not** verified for this repo; such claims are flagged inline.
- **Catalog snapshot.** Statements about specific models are pinned to the current catalog (`lib/models/data/*`, `lastVerifiedAt: 2026-03-08`), whose newest Claude is Opus/Sonnet 4.6 and whose Grok entries are `grok-4-0709` / `grok-4-1-*` / `grok-code-fast-1`. Provider facts about models not yet in the catalog are marked **forward-looking**.

## Official Source Findings

### AI SDK v6

Relevant official docs:

- [AI SDK `streamText` reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [AI SDK UI stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [AI SDK `useChat` reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)

Research findings:

- `streamText(...)` is the correct server primitive for streaming text and tool-using responses in this repo's AI SDK v6 setup.
- `toUIMessageStreamResponse(...)` can forward reasoning and sources into UI message streams through options such as `sendReasoning` and `sendSources`.
- The UI message stream protocol has explicit reasoning events: `reasoning-start`, `reasoning-delta`, and `reasoning-end`.
- The UI stream protocol also has source parts and tool parts. Those are separate from reasoning and should stay separate in the product taxonomy.
- AI SDK has multiple reasoning-related surfaces: stream transport to the client, provider options that control model behavior, UI message parts, and usage metadata. These should not be collapsed into one concept named "reasoning."
- AI SDK stream parts are normalized enough to let the app render provider-agnostic UI message parts, but they do not by themselves prove that hidden reasoning happened. Hidden reasoning needs send-time request policy, provider metadata, usage fields, or provider-specific evidence.
- AI SDK v6 mutates message parts during streaming. Existing tests and comments already account for this in the activity-panel and message memoization work; future state derivation must not rely on stable `parts` array identity during active streams.

Implication for planning:

- The most stable cross-provider concept from AI SDK is "UI message part type," not "provider thinking model."
- `reasoning` parts are display evidence. They are not a complete model-capability taxonomy.
- `sendReasoning: true` is not a UX policy. It is a stream transport choice that gates only **structured reasoning parts** — it is one of two independent safety boundaries, and it does **not** gate text-embedded reasoning in `content` (see Reasoning Transport Forms). The server/display pipeline must still decide whether each reasoning artifact is displayable, hidden, replay-only, encrypted, or unsafe.

### OpenAI

Relevant official docs:

- [OpenAI reasoning models guide](https://developers.openai.com/api/docs/guides/reasoning)
- [OpenAI Responses API reasoning guide](https://platform.openai.com/docs/guides/reasoning)

Research findings:

- OpenAI reasoning models can consume hidden reasoning tokens.
- Reasoning effort is request-configurable for supported models.
- Reasoning summaries can be requested for supported Responses API models, but hidden reasoning tokens are not the same thing as displayable reasoning content.
- OpenAI reasoning/tool replay can carry provider-linked response item invariants; this repo already has OpenAI-specific history adaptation for reasoning/tool/result continuity.

Implication for planning:

- OpenAI should not be modeled as "visible thoughts" by default.
- It likely needs separate fields for hidden reasoning support, reasoning effort, displayable summary availability, and replay invariants.
- A timer/status treatment can be valid when reasoning was configured but no displayable summary/content is emitted.

### Anthropic

Relevant official docs:

- [Anthropic extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Anthropic tool use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)

Research findings:

- Anthropic supports extended thinking with token budgets and newer adaptive thinking modes.
- Thinking content has provider-specific continuity requirements, including signatures and tool-use interactions.
- The docs distinguish controlling how thinking content is returned from merely enabling extended thinking.
- Newer Anthropic surfaces distinguish summarized/omitted thinking display. A request can enable thinking while returning no displayable thinking deltas, so "reasoning requested" and "reasoning content displayed" must remain separate.
- Opaque artifacts such as signatures or redacted/encrypted thinking are continuity/safety artifacts, not user-displayable text.
- This repo already has Anthropic request-shaping logic for adaptive thinking and a workaround for `pause_turn` with search tools.
- This repo's Anthropic history adapter preserves reasoning and tool chains more directly than openai-compatible providers.

Implication for planning:

- Anthropic thinking is not just a visual feature. It affects request shaping and replay/history correctness.
- Display policy still needs product judgment: "provider returned a thinking block" does not automatically mean the product should display it as raw thoughts.
- If displayed, the safest product label is "Reasoning summary" or "Activity," not "chain-of-thought."
- Replay-preserved Anthropic thinking/signature material should be modeled independently from displayable reasoning summaries.

### Google Gemini

Relevant official docs:

- [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking)

Research findings:

- Gemini thinking can be configured with thinking budgets for supported models.
- Gemini can include thought summaries when `includeThoughts` is enabled.
- Gemini's returned thought summaries are not equivalent to raw internal chain-of-thought.
- Gemini docs have version-specific thinking surfaces: 2.5-era `thinkingConfig`/`includeThoughts` and newer thinking-level/summary concepts. The research should not assume the AI SDK option names and provider REST terms are identical.
- This repo currently sets `google.thinkingConfig.includeThoughts = true` when `reasoningText` is true.
- This repo's Google history adapter treats reasoning as a structural thought-signature concern.

Implication for planning:

- Gemini belongs in a "displayable summary/activity possible" bucket when `includeThoughts` is enabled and reasoning parts are emitted.
- The display layer should still depend on actual stream parts and send-time policy, not only catalog metadata.

### xAI

Relevant official docs:

- [xAI reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning)

Research findings:

- xAI exposes reasoning controls such as reasoning effort for supported models.
- xAI docs include reasoning content concepts that may be encrypted or provider-specific.
- xAI reasoning exposure appears to vary by model family; a provider-wide "displayable" flag would be too coarse.
- The repo currently uses openai-compatible history adaptation for xAI/Mistral-style providers and drops reasoning parts in that adapter.
- The repo currently shapes xAI reasoning requests with `{ xai: { reasoningEffort: "medium" } }` when `reasoningText` is true.

Implication for planning:

- xAI should not be treated as displayable reasoning merely because a reasoning effort option exists.
- A model can support reasoning controls while still having no user-safe displayable content.

### OpenRouter

Relevant official docs:

- [OpenRouter reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)

Research findings:

- OpenRouter can expose reasoning-related fields across wrapped models, but behavior depends on the upstream model and route.
- It is a wrapper provider, so model capability may differ by base model and provider route.
- OpenRouter can normalize reasoning into typed reasoning detail fields, including text, summary, and encrypted variants. Those variants have different display safety.
- The repo's model config currently marks listed OpenRouter models with `reasoningText: true`, but request shaping does not add OpenRouter reasoning options.

Implication for planning:

- OpenRouter needs caveats in the capability model.
- Wrapped-provider capability should be represented as possibly model-specific and route-specific, not a stable provider-wide fact.
- The future research/fixture pass should prefer route/model evidence over hardcoded provider-level assumptions.

### Perplexity

Relevant official docs:

- [Perplexity Sonar Reasoning Pro](https://docs.perplexity.ai/docs/sonar/models/sonar-reasoning-pro)
- [Perplexity API docs](https://docs.perplexity.ai/)

Research findings:

- Perplexity has explicit reasoning model SKUs.
- Perplexity may surface reasoning-style content differently from AI SDK reasoning parts depending on model/API response format.
- Perplexity Sonar reasoning examples show reasoning embedded inside normal assistant content as `<think>...</think>`. That is not automatically a safe UI reasoning part.
- The repo currently marks Perplexity reasoning models with `reasoningText: false`.

Implication for planning:

- Perplexity may belong in "hidden/unknown display" until actual AI SDK/provider output fixtures prove whether displayable reasoning summaries arrive as structured parts.
- Do not infer displayability from marketing/model tags.
- Treat text-embedded reasoning as unsafe answer content until fixtures prove it is stripped, normalized, or explicitly sanctioned as displayable summary content.

## Stable Cross-Provider Concepts

These concepts appear stable enough to model as product primitives:

- A request may have no reasoning capability.
- A request may enable hidden reasoning that produces no displayable content.
- A request may produce displayable provider-returned reasoning summaries or activity-like content.
- Reasoning controls can include effort, budget tokens, adaptive mode, and provider-specific caveats.
- Tool calls are not reasoning.
- Source citations are not reasoning.
- User approval is not reasoning.
- Waiting for the first answer token is not necessarily reasoning.
- Current model catalog metadata can change after a message was generated; historical rendering should use send-time metadata.

## Reasoning Transport Forms

Provider reasoning can reach the app through different transport forms. The research and later implementation plan should classify the transport form before deciding UI treatment.

| Transport form | Example evidence | Display default | Research implication |
| --- | --- | --- | --- |
| Structured AI SDK reasoning part | `UIMessage.parts[]` contains `type: "reasoning"` | display only if provider/model policy says the text is a user-safe summary/activity | Reasoning parts are evidence of returned content, not proof that the content is safe in every provider context |
| Provider summary/activity field normalized by SDK | OpenAI/Gemini/Anthropic safe summary-style output | potentially displayable behind disclosure | Needs provider/model fixture proof and neutral copy |
| Hidden reasoning occurrence | reasoning tokens, effective request policy, provider usage metadata, no visible part | timer/status only at most | Distinguish "reasoning happened" from "reasoning text exists" |
| Replay-only reasoning artifact | signatures, encrypted content, response-linked IDs, thought signatures | never display | Preserve only for provider continuity if needed |
| Text-embedded reasoning | `<think>...</think>`, `[THINK]`, provider-specific answer-prefix traces | unsafe by default | Must be stripped, normalized, or explicitly classified before answer rendering |
| Unknown/provider-compatible output | wrapped routes, openai-compatible adapters, marketing-only reasoning tags | no `Thinking` and no reasoning panel by default | Requires fixtures before UI promises |

The important unsafe case is text-embedded reasoning. It can bypass `sendReasoning`, appear as normal answer text, persist in `messages.parts` **and `messages.content`**, and render in shared/public output. That case should be tracked separately from structured reasoning parts and should not be treated as displayable content merely because users can see it.

**Where the boundary must sit (location, not just timing).** "Stripped, normalized, or classified before answer rendering" is necessary but under-specified: the reachable leak is *durable*, not render-time. Verified path — a `<think>...</think>` delta is accumulated into the text snapshot (`app/api/chat/durable-runtime.ts`), written verbatim into `messages.content`, and rendered on the public share article (`app/share/[chatId]/article.tsx`, markdown) — and no `<think>` stripping exists anywhere in `lib/`/`app/`/`convex/` (grep empty). Because the share path reads the persisted `content` column and never executes private-chat React logic, **any sanitization confined to the render tree leaves the public leak intact.** Research implication: the safety boundary must be the durable write (the `content`/snapshot accumulator) or earlier — not render time. Note the markdown renderer runs without `rehype-raw`, so the `<think>` *tags* are dropped but the CoT prose between them still renders as visible answer text; this is a content-segregation problem, not HTML injection. The catalog's live text-embedded sources are `openrouter:deepseek/deepseek-r1:free` (`reasoningText: true`) and Perplexity sonar-reasoning (always-on `<think>`); the installed `@ai-sdk/perplexity@3.0.17` emits zero structured reasoning parts, so its `<think>` stays in `content`.

## Provider-Specific Concepts

These should not leak into generic UI components:

- OpenAI reasoning summary request options and response/replay item IDs.
- Anthropic thinking mode, budget tokens, signatures, and `pause_turn` behavior.
- Gemini `thinkingConfig.includeThoughts`, thought summaries, and thought signatures.
- xAI reasoning effort and any encrypted/provider-specific reasoning content.
- OpenRouter route/model-specific reasoning normalization.
- Perplexity model-specific reasoning formats.

## Current Repo State Map

### Model Capability Registry

Current source:

- `lib/models/types.ts`
- `lib/models/data/*.ts`
- `lib/models/index.ts`

Observed shape:

- `ModelConfig.reasoningText?: boolean`
- `ModelConfig.thinkingMode?: "adaptive" | "enabled"`
- `ModelConfig.thinkingBudget?: number`

Catalog observations (verified against `lib/models/data/*`):

- OpenAI, Claude, Gemini, Grok, and OpenRouter models use `reasoningText: true` for some entries (15 `true` / 16 `false` overall).
- **All** Mistral entries and **all** Perplexity entries are `reasoningText: false`, even when descriptions/tags mention reasoning — so they never reach provider reasoning request shaping (see Request Shaping below).
- Perplexity reasoning SKUs are explicitly tagged/described as reasoning models but still have `reasoningText: false`.
- The two OpenRouter entries are `idKind: "wrapped"` and both marked `reasoningText: true`. One of them, `openrouter:meta-llama/llama-3.3-8b-instruct:free`, is **not** a reasoning model — a concrete instance of catalog flags drifting from upstream truth (prefer route/model evidence over a hardcoded flag).
- `deepseek.ts` and `llama.ts` export **empty arrays**, and `llama.ts` is not imported into `lib/models/index.ts` (`getAllModels()` spreads 8 of 9 data files). Any DeepSeek/Llama reasoning fixture or caveat targets a non-existent *native* catalog entry; the only live DeepSeek/Llama models are the OpenRouter-wrapped ones above.

Research concern:

`reasoningText` is too overloaded. It appears to mean at least four different things depending on context:

- the model supports reasoning,
- the app should enable provider reasoning options,
- the stream may contain displayable reasoning text,
- the UI may show a thinking state.

Those are not the same fact. Note also that the registry is not a single clean boolean to graduate: it already carries two **Anthropic-scoped** reasoning sub-fields (`thinkingMode`, `thinkingBudget`) read only in the request-shaping Anthropic branch. The current shape is one boolean *plus* a partial Anthropic-only sub-model — a graduation must decide whether to generalize these or leave them provider-scoped.

### Request Shaping

Current source:

- `lib/openproviders/request-shaping.ts`
- `lib/openproviders/request-shaping.test.ts`

Current behavior:

- If `modelConfig.reasoningText` is falsy, provider reasoning options are not sent.
- Anthropic:
  - adaptive thinking if `thinkingMode === "adaptive"` and search is not active,
  - fixed enabled thinking with budget tokens otherwise,
  - search-active adaptive downgrade exists because of `pause_turn` behavior.
- Google:
  - sends `thinkingConfig.includeThoughts = true`.
- OpenAI:
  - sends `reasoningEffort = "medium"` and `reasoningSummary = "auto"`.
- xAI:
  - sends `reasoningEffort = "medium"`.
- Anthropic tool-efficient headers are independent of `reasoningText`.

Research concern:

This is the right architectural seam for provider request policy, but it currently consumes an ambiguous display flag. The future contract needs to answer separately:

- Should reasoning be requested?
- How should reasoning be requested?
- Is displayable reasoning expected?
- What should the UI do if displayable reasoning does not arrive?
- What should the server do if unsafe/text-embedded reasoning arrives?
- What caveat should be persisted if request shaping downgraded or omitted a requested capability?

### Streaming Normalization

Current source:

- `app/api/chat/chat-turn-runtime.ts`
- `app/api/chat/durable-runtime.ts`
- `lib/tools/ui-metadata.ts`
- `convex/lib/messageMetadata.ts`

Current behavior:

- The chat route is a thin HTTP adapter.
- The Chat turn runtime prepares model/key/tools/history/request shaping and owns `streamText`.
- `toUIMessageStreamResponse` is called with `sendReasoning: true` and `sendSources: true`.
- `onChunk` starts `reasoningStartMs` on `chunk.type === "reasoning-delta"`.
- `onChunk` freezes `reasoningDurationMs` when `text-delta` arrives after reasoning.
- `onFinish` freezes a reasoning duration if reasoning started and text never arrived.
- Response-level `messageMetadata` persists `reasoningDurationMs` and tool metadata.

Research concern:

Runtime duration currently depends on visible `reasoning-delta`. Hidden reasoning with no visible reasoning delta does not get runtime duration metadata. That is correct as a stream observation, but insufficient for a UX that may want timer-only hidden reasoning based on send-time policy.

> **Reconciliation (see Addendum "Verified durability and replay details").** For *completed* turns, `reasoningDurationMs` **is** durably persisted and survives reload, and reasoning *text* persists verbatim in `messages.parts`. So the durable gap is **not** "add duration persistence" — it is (a) occurrence/exposure semantics (was reasoning hidden vs displayable; what does the duration measure) and (b) abort/fail loss. Do not read this section as evidence that persistence is absent.

### Durable Message Lifecycle

Current source:

- `convex/schema.ts`
- `convex/chatRuntime.ts`
- `convex/lib/messageMetadata.ts`
- `lib/chat-messages/metadata.ts`
- `lib/chat-messages/ui-message-adapter.ts`
- `lib/chat-store/turns/selected-path.ts`

Current status vocabulary:

- `submitted`
- `streaming`
- `completed`
- `aborted`
- `failed`
- `awaiting_approval`

Current durable fields:

- `messages.parts` stores AI SDK parts.
- `messages.status` stores lifecycle.
- `messages.model` and `messages.provider` store generation identity.
- `messages.finishReason`, `usage`, and `error` store terminal metadata.
- `messages.metadata` stores narrowed `vToolInvocationStreamMetadata`.
- `metadata.reasoningDurationMs` is currently the only reasoning-related durable metadata.

Research concern:

Historical rendering cannot rely on the current selected model because:

- the model catalog can change,
- the selected model can change,
- provider routing can change,
- historical messages may lack new metadata,
- branches/regenerations produce sibling assistant messages with different capabilities.

Send-time reasoning policy belongs in durable assistant metadata or an equivalent durable generation-run projection.

### Provider History Adaptation

Current source:

- `app/api/chat/adapters/*`
- `app/api/chat/replay/*`

Current behavior:

- OpenAI adapter treats reasoning/tool/result triples as structurally important.
- OpenAI-compatible adapter drops reasoning, step-start, and source parts.
- Anthropic adapter preserves reasoning and handles tool/web-search replay details.
- Google adapter preserves/transforms reasoning around thought signatures.
- Deprecated utility `sanitizeMessagesForProvider` still documents the older rule: Anthropic preserves reasoning/tool artifacts, most others strip provider-specific internal parts.

Research concern:

Reasoning is already provider-sensitive at replay time. Any UI/display decision that directly checks `providerId` in components will duplicate this complexity in the wrong layer. Provider-specific normalization should stay server/runtime-side; UI should consume normalized capability/event/message metadata.

Replay preservation is not display permission. Reasoning/signature artifacts can be required for future provider calls while remaining hidden, encrypted, unsafe, or irrelevant to the user-facing activity panel.

### Chat Lifecycle UI

Current source:

- `app/components/chat/use-chat-core.ts`
- `app/components/chat/chat-turn.ts`
- `app/components/chat/conversation.tsx`
- `app/components/chat/message.tsx`
- `app/components/chat/message-assistant.tsx`
- `app/components/chat/use-activity-panel.ts`
- `app/components/chat/use-reasoning-phase.ts`
- `app/components/chat/use-loading-state.ts`
- `app/components/chat/activity/*`
- `app/components/chat/tool-invocation.tsx`

Current behavior:

- `useChat` owns live streaming messages.
- Selected-path projection installs backend-selected durable history only when idle/error.
- `useActivityPanel` is chat-owned and selects a default or explicit assistant turn.
- `useReasoningPhase` derives `idle`, `thinking`, or `complete` from reasoning parts and status.
- `MessageAssistant` shows an activity trigger when submitted, reasoning exists, sources exist, or tool activity exists.
- Pending submitted assistant state is currently treated as `Thinking` with opaque reasoning, even without model capability input.
- `useLoadingState` suppresses generic "Generating" if any reasoning part exists, although the comment says "visible text."
- Tool approval/running/completed/failed states are already distinct inside `ToolInvocation`.

Research concern:

The UI has good ownership direction after activity-panel work, but display eligibility is still derived from local UI conditions rather than normalized model/runtime facts. Specifically:

- submitted pending state currently equals `Thinking`;
- any reasoning part equals activity trigger;
- hidden/opaque reasoning is inferred from empty reasoning text;
- no model capability is available to the presentation state.

### Shared/Public Chats

Current source:

- `app/share/[chatId]/page.tsx`
- `app/share/[chatId]/article.tsx`
- `convex/messages.ts`

Current behavior:

- Public messages are fetched server-side.
- Shared article renders message content and inline sources. The article's message type omits a `metadata` field entirely, so reasoning metadata is never passed to it.
- Shared article does not currently render the activity panel.
- Shared article does not currently receive the full private-chat metadata surface needed for reasoning display decisions.
- The public read (`getPublicForChat`, `convex/messages.ts`) gates only on `chat.public` and filters only `awaiting_approval`. There is **no per-message ACL and no share-link token** beyond `chat.public`. The upstream visibility filter (`convex/domain/message_visibility.ts`) is **status-independent** (it drops only empty assistants).

Research concern:

Shared read-only rendering needs a separate decision:

- Should completed displayable reasoning summaries appear publicly?
- Should hidden timer-only metadata appear publicly?
- Should tool activity appear publicly?
- Should historical provider caveats appear publicly?

The safest default is to display answer content and sources, and only display reasoning summaries when the product explicitly decides public shared chats include them.

**Two security findings, not cosmetic open questions:**

1. **Content sanitization is the actual leak control, not reasoning-metadata policy.** The verified danger is text-embedded reasoning (`<think>`) inside `messages.content`, which the article renders directly — independent of model capability (it bites even non-reasoning Perplexity text). It is *not* captured by "reasoning summary vs no reasoning metadata." Add a Public/share value: **content sanitization** (is `content` guaranteed free of text-embedded CoT before public projection?).
2. **Terminal-status gating.** Because the public read filters only `awaiting_approval` and the visibility filter is status-independent, a `streaming`/`aborted`/`failed` assistant with any semantic part — including a half-streamed `<think>` block that never reached the completion path where a future strip would run — renders publicly with **no indicator** the instant the chat is marked public. Add a Public/share value: **terminal-status gating** (should public projection exclude non-`completed` assistant turns?). This is a security gate, not a "badge incomplete turns" nicety (cf. Addendum open question #8).

### Local Guest Chats

Current source:

- `lib/chat-store/identity.ts`
- `lib/chat-store/messages/provider.tsx`
- `lib/chat-store/turns/chat-turn-service.ts`
- `app/c/[chatId]/page.tsx`

Current behavior:

- Guest/local chats use local persistence and IndexedDB snapshots.
- Durable edit/regenerate branches are unavailable for local chats.
- Local chats do not have server selected-path projection.

Research concern:

If thinking metadata is only durable-server-side, local guest chats will fall back to parts-only behavior. The implementation plan should decide whether local cache snapshots need the same metadata shape.

## Capability Taxonomy Inputs

The implementation plan should use composable research axes instead of one candidate API or one overloaded boolean. In particular, "model can reason," "request actually enabled reasoning," "reasoning happened," and "displayable reasoning text exists" are separate facts.

**Minimal sufficient core.** The smallest model the evidence supports is **three facts**, not seven co-equal axes (the seven below double-count and over-model — see notes):

- **(A) `disclosure` — static, per-model prediction** {none | summary | raw | unknown}: could this model emit displayable reasoning if requested? Catalog metadata can be stale/too broad (OpenRouter, xAI, Perplexity, provider-compatible routes), and per-model variance (Grok by model, OpenRouter by upstream) makes a provider-level flag demonstrably wrong.
- **(B) observed `reasoningExposure` + occurrence signal — durable, per assistant row, written at finish**: what actually came back (safe summary / safe activity / unsafe raw-text-embedded / encrypted-replay-only / unknown) plus whether reasoning happened. Runtime-observed exposure **wins over** the static prediction (A) — *when it was durably captured*; see the conflict-resolution note below.
- **(C) display treatment — derived, not stored**: a pure function of (A), (B), and message status. Effective request policy is *one source* of (B), not a separate fact.

> Field names above (`disclosure`, `reasoningExposure`) are **illustrative only**; per the "How To Read This Document" altitude rubric and the planning note below, the doc does not pre-commit to TypeScript shapes, enum values, or precedence. The remaining concerns — effort knobs, public/share policy, timer-kind, tool folding, replay — are **deferrable refinements**, not core axes.

**Conflict resolution (reload / abort).** "Observed wins" needs a tiebreak in the two cases that matter for a durable system: (1) on **reload** of a completed turn, the static prediction may have changed (catalog edited) while durable observed exposure is fixed — persisting observed exposure send-time is what makes static drift irrelevant; (2) on **abort/fail**, observed exposure is currently never persisted (`reasoningDurationMs` is lost; metadata is not written), so "observed wins" has nothing to win with. The fallback order must be specified as: observed-exposure → surviving-safe-parts → static-prediction → none. Making "observed wins" reliable on interrupted turns requires deciding whether to flush occurrence/exposure on the abort path (Addendum open question #3).

**Existing displayability authority — do not re-derive.** `convex/domain/message_visibility.ts` (`isSemanticMessagePart`) already classifies a reasoning part as semantic only when `text` is a non-empty string, and filters empty/opaque reasoning out of both visible-chat and model history. Any new exposure classification must **consume or extend** this predicate, not re-derive presence in a parallel layer (the same duplication the doc warns about for provider-branching in components). The new classification should capture only what `message_visibility` does not: safe-summary vs raw-trace vs encrypted/replay-only. Caution: "empty reasoning text" is an **overloaded** signal — the installed `@ai-sdk/anthropic` surfaces `redacted_thinking` as an *empty* part with `providerMetadata.anthropic.redactedData`, and the OpenAI replay compiler injects empty synthetic parts — so a safe policy must branch on `providerMetadata`, never on text-emptiness alone, and must never derive a "reasoning available" affordance from empty-text parts.

The seven axes below remain a useful *decomposition aid*, but they are **not orthogonal** and should not be read as a mandated schema: "Effective request policy" is a source of "Reasoning occurrence evidence" (not a sibling); "Display treatment" is the pure output of "Displayable content evidence"; "Replay requirement" is out of scope (Addendum: "treat replay as out of scope"); and "Public/share eligibility" is a per-surface rendering policy, not a model capability (it applies even to non-reasoning models — see Shared/Public Chats).

| Axis | Example values | Question answered | Notes |
| --- | --- | --- | --- |
| Static model prediction (= core fact A) | none, can reason, unknown | Could this model perform reasoning if requested? | Catalog metadata can be stale or too broad, especially for OpenRouter, xAI, Perplexity, and provider-compatible routes |
| Effective request policy (a *source* of occurrence, not a sibling) | not requested, requested, downgraded, omitted, unknown | Did this turn actually ask the provider for reasoning? | Belongs near request shaping, not presentation components; the only genuinely per-request variation is the Anthropic search-active downgrade — the catalog-vs-switch mismatch is deterministic per model |
| Reasoning occurrence evidence (= core fact B, part 1) | none, inferred from request, usage tokens, visible deltas, provider metadata | Did reasoning likely happen for this turn? | Hidden reasoning may have no visible parts |
| Displayable content evidence (= core fact B, part 2) | none, safe summary, safe activity, unsafe raw/text-embedded, encrypted/replay-only, unknown | Is there text the product may show to users? | Runtime-observed exposure should override static predictions; consume `message_visibility`, do not re-derive presence |
| Display treatment (= core fact C, derived not stored) | none, generating-only, timer-only, summary disclosure, activity disclosure | What should the UI say/show? | This is downstream of policy and evidence |
| Replay requirement (**out of scope** — not a capability axis) | none, preserve parts, preserve signature, preserve response-linked item, strip before replay | What must be kept for future provider calls? | Replay preservation is not display permission; see "A reasoning-replay boundary the capability layer must NOT absorb" |
| Public/share eligibility (**rendering-surface policy**, not a capability) | answer only, sources, tools, reasoning summary, no reasoning metadata, content-sanitized, terminal-only | What may appear outside the private chat UI? | Capability-independent; enforce at the content/render boundary (see Shared/Public Chats) |

### Tool Activity

Tool activity should be separate from reasoning. The research should ground product-level states in the raw states the app already receives and persists:

- AI SDK tool part states such as input streaming, input available, output available, output error, and denial.
- Durable tool invocation states such as `called`, `pending_approval`, `approved`, `denied`, `completed`, and `failed`.
- Assistant lifecycle state `awaiting_approval`, which means the system is waiting on the user, not the model.

Questions this axis answers:

- Should the status label be `Working`, `Review`, `Running`, `Completed`, or `Failed`?
- Should a tool timeline appear even when the model has no reasoning support?
- Should the trigger say `Activity` rather than `Thinking`?

### Sources

Sources should be separate from reasoning:

- `source-url`
- `source-document`
- tool-produced citation output

Questions this axis answers:

- Should the trigger say `N sources`?
- Should the panel be available on non-reasoning models because sources exist?
- Should public shared chats display sources even if reasoning is hidden?

### Provider/Model Caveats

Capability needs an escape hatch for:

- OpenRouter wrapped model uncertainty and route-specific reasoning fields.
- Perplexity text-embedded reasoning output format.
- Anthropic display omitted/summarized behavior, `pause_turn`, signatures, and tool interactions.
- Google thought-signature history requirements and version-specific thinking controls.
- xAI per-model disclosure differences and encrypted/provider-specific reasoning content.
- Model ID aliases/snapshots/legacy entries.

Planning note:

The implementation plan should decide whether normalized capability belongs directly on `ModelConfig`, in a derived helper such as `resolveModelCapabilities(modelConfig)`, or as a separate registry/request-shaping projection. This research should not pre-commit to concrete TypeScript shapes. The research finding is only that raw `ModelConfig.reasoningText` cannot carry support, request policy, occurrence, and display policy.

## Runtime Evidence Taxonomy

A presentation state machine needs more than model capability. It needs runtime evidence — but the evidence is **not flat**: it spans three lifetimes/owners that belong in different layers. Classifying by lifetime prevents an implementation from threading all of it into one function or, worse, persisting ephemeral signals. (The repo already separates these: durable facts live in `vToolInvocationStreamMetadata`; derived facts are recomputed each render by `use-reasoning-phase`, which deliberately does not memoize on `parts` because the SDK mutates parts in place.)

**Durable, send-time, per assistant row (persisted):**

- selected-at-send model id and provider id,
- effective request policy (esp. the per-request Anthropic search downgrade),
- reasoning exposure classification,
- occurrence signal (usage reasoning tokens if the provider populates them; see Provider Semantics),
- `reasoningDurationMs` **and its duration-kind**,
- finish reason, abort/failure state.

**Ephemeral live-stream (must NOT be persisted):**

- visible reasoning streaming/done state,
- live timer,
- stream status.

**Derived per render (recomputed from parts, never stored):**

- visible reasoning part count and reasoning text presence,
- text-embedded reasoning markers or provider-specific unsafe traces,
- source count,
- tool part states, approval state,
- message lifecycle status (read from the durable row),
- branch identity and selected-path membership,
- public/local persistence mode.

## UI State Matrix Inputs

This matrix enumerates inputs, not a resolved spec. Most rows are the Cartesian product of `{status}` × `{reasoning: none/hidden/visible}` and **collapse** once the core derivation function (C, above) exists — e.g. "Stopped during hidden reasoning," "Stopped during visible reasoning," "Failed before reasoning," and "Failed after reasoning" express one rule (terminal status × whether safe parts survived), and the abort/fail mechanics are uniform (the terminal mutation patches `status`+`error` only; empty-parts assistants are deleted entirely). The genuinely research-worthy rows are the ambiguous ones (hidden-reasoning timer, unknown-capability, text-embedded); the mechanical ones are noise. Treat the **Label / Surface / Persistence** columns as *candidate treatments to validate*, not decisions.

| State | Evidence | Label Research | Surface Research | Persistence Research |
| --- | --- | --- | --- | --- |
| No reasoning support | send-time support `none`, no reasoning parts | no `Thinking`; generic `Generating` only if needed | no panel unless tools/sources exist | no reasoning metadata required |
| Unknown capability | support `unknown`, no reasoning parts | prefer `Working` or no label; avoid `Thinking` | no reasoning panel | persist unknown if send-time capability unresolved |
| Waiting for first token, no reasoning | submitted/streaming, no reasoning capability | `Generating` after delay if empty | no activity trigger unless tool/source evidence | no fake reasoning duration |
| Waiting for first token, hidden reasoning | effective reasoning policy or durable occurrence evidence, no displayable parts | optional `Thinking`/`Working` timer only if product chooses hidden-reasoning disclosure | no reasoning text; avoid empty "thoughts" panel | persist send-time policy, occurrence evidence, and duration semantics if measured/derived |
| Waiting for first token, displayable reasoning expected | effective policy predicts safe summary/activity, but no parts yet | `Thinking` acceptable only as a provisional reasoning lane label | panel can remain empty/timer-only until safe parts arrive | persist policy even if no parts arrive |
| Visible safe reasoning streaming | reasoning parts streaming and classified displayable | `Thinking` | panel with provider-safe summary/activity | persist parts, exposure classification, and duration |
| Unsafe/text-embedded reasoning observed | answer content contains provider reasoning markers or raw trace format | no user-facing reasoning label; answer rendering requires stripping/normalization decision **at the durable write boundary** | do not display as answer or reasoning until classified | record occurrence without storing raw CoT (raw CoT capture is itself sensitive — see Security) |
| Reasoning complete, answer streaming | displayable reasoning done, text streaming | `Reasoned for X` **only if duration-kind is genuine visible-reasoning**; otherwise neutral (`Worked for X` / no timer) | panel available, answer streams normally | persist duration **and duration-kind** and exposure classification |
| Answer streaming without reasoning | text deltas, no reasoning evidence | no thinking label | answer body only | no reasoning metadata |
| Tool pending/running | tool input/approval/output state not terminal | `Working`, `Running`, or tool-specific label | tool card/timeline, not reasoning | persist tool metadata/outcomes |
| Approval required | `awaiting_approval` or `approval-requested` part | `Review` / `Approval required` | approval UI primary | no reasoning implication |
| Tool completed/failed | output available/error | `Completed` / `Failed` | inline or activity entry | persist outcome |
| Stopped during hidden reasoning | abort before text/parts | `Stopped before answer` if surfaced | no thoughts | persist only if assistant message survives |
| Stopped during visible reasoning | abort after reasoning parts | `Stopped` plus activity available | preserve safe partial reasoning | persist partial parts/status |
| Failed before reasoning | failed, no parts | error only | no panel | error metadata |
| Failed after reasoning | failed, reasoning parts exist | `Failed` / `Interrupted` | preserve safe activity | failed status plus parts |
| Regenerated sibling | selected assistant sibling changes | label per selected sibling | one trigger per visible assistant with activity | metadata per sibling |
| Edited/resubmitted branch | selected path changes | label per selected path | panel follows selected turn | do not infer from hidden siblings |
| Reload/restored chat | stored parts/metadata | fixed labels, no live timer | read-only historical panel | use persisted send-time metadata |
| Shared public chat | public read-only data | conservative labels | answer/sources; reasoning TBD | do not expose hidden metadata by accident |
| Local guest chat | IndexedDB/local snapshots | degrade to parts-only | no durable assumptions | local metadata parity decision needed |
| Provider fallback | request shaping omitted/downgraded | neutral `Working` or caveated status | avoid `Thinking` if reasoning not effective | persist effective policy/caveat |

## Copy And Disclosure Research

This section has two tiers that must not be conflated:

- **Tier A — copy safety constraints (decision-ready, not user research):** no thinking/thought/Pro-thinking string without per-turn reasoning capability; no anthropomorphic frame on summary content; raw CoT never rendered as answer or reasoning; a reasoning verb must not attach to network-wait or absent-reasoning durations.
- **Tier B — copy preference questions (need user research / A-B):** Reasoned-vs-Thought-vs-Worked tone; withheld/encrypted note vs silent; hidden timer-only disclosure; display-directly vs behind-disclosure. (Map each Open Question Product #1–8 to a tier.)

### Actively Misleading Labels Shipping Today (Tier A — currently violated)

The thinking affordance is gated on `status === "submitted"` + parts-presence, never on capability, so these strings render for **any** pending last turn — including non-reasoning and free-tier models:

- the live trigger renders **`Thinking`** (`activity-panel-trigger.tsx`),
- the completed trigger renders **`Thought for X`** (`activity-panel-trigger.tsx`),
- the panel body heading is the hard-coded string **`Pro thinking`** (`activity-panel.tsx:83`),

all driven by `isSubmittedPending || isReasoningStreaming` (`message-assistant.tsx`) and the hard-coded pending placeholder (`use-activity-panel.ts`, `phase: "thinking"`). For a non-reasoning model (Mistral, Perplexity, Grok-non-reasoning, or any model where request shaping emitted `default: {}`), this asserts the model is "thinking" when no reasoning was requested or returned; `Pro thinking` additionally asserts a tier the model lacks. This is a present-tense product-truthfulness defect, not a future risk. Copy constraint: no thinking/thought/Pro-thinking string may render unless effective reasoning policy or observed reasoning evidence is true for **this** turn.

### Faithfulness Constrains The Vocabulary (Tier A)

Provider primary sources make anthropomorphic copy a *truthfulness* problem, not a tone preference. Anthropic returns a **summary produced by a different model** that "[doesn't necessarily] truly represent[] what's going on in the model's mind"; OpenAI never exposes raw reasoning tokens, only a summary. So `Thought` (implying the user sees the model's actual private thoughts) misrepresents *what the content is* (a post-hoc summary), not merely its tone. Rule: frame displayed reasoning as "the model's stated reasoning" / "reasoning summary," never as private thoughts; `Thought for X` is disfavored on faithfulness grounds, not style.

### When To Say `Thinking`

Use `Thinking` only when both are true:

- the turn has effective reasoning policy or observed reasoning occurrence evidence, and
- the current state is before/during the reasoning lane or safe displayable reasoning is streaming.

Do not use `Thinking` for:

- non-reasoning models waiting for first token,
- generic network latency,
- static catalog capability without effective request/evidence,
- tool-only work,
- approval-required states,
- unknown provider capability,
- source citation rendering,
- text-embedded/raw reasoning that has not been normalized and classified as safe,
- answer text streaming after reasoning is complete.

### When To Say `Working`

`Working` is safer when:

- the model capability is unknown,
- a tool/search/image operation is active,
- provider fallback/downgrade makes reasoning uncertain,
- no displayable reasoning exists but the app wants to acknowledge progress.

### When To Say `Generating`

`Generating` is appropriate for:

- answer text being produced by a non-reasoning model,
- an empty assistant response before first text when no reasoning capability is known,
- continuation after reasoning has completed if the product needs an inline loader.

Caveat (verified): the shipped loader suppresses the `Generating` shimmer on reasoning-part **presence**, not visible text (`use-loading-state.ts`; the comment says "visible text" but there is no text test). So an empty/opaque reasoning part — Claude `display:omitted` signature-only block, or `redacted_thinking` empty part — suppresses `Generating` while the body shows an empty reasoning section and no answer: the user sees neither a loader nor any reasoning text. Rule: `Generating` suppression must key on visible reasoning **text**, not part presence.

### Completed Labels

Candidate labels to evaluate (this is the **one canonical place** for the completed-label recommendation; the UI State Matrix and Open Question Product #6 should reference it, not restate it):

- `Reasoned for 8s`: precise and neutral, but **conditional** — only valid when duration-kind is genuine visible reasoning (Tier A; see "Duration-kind gates label-kind" below). Not a default.
- `Worked for 8s`: neutral, but may blur tool activity and reasoning.
- `Thought for 8s`: familiar from existing UI, but **disfavored on faithfulness grounds** (it misrepresents a summary as private thoughts), not merely tone.
- `Activity`: safe fallback when the turn includes tools/sources but no reasoning.
- `3 sources`: clear when the panel is only citations.

Research concern:

Existing `ActivityPanelTrigger` says `Thought for X`. The shipped panel uses **two** header strings — the panel header title defaults to `Activity` (`activity-panel.tsx:119`) **and** the body section heading is the hard-coded `Pro thinking` (`activity-panel.tsx:83`) — so a single open panel can show header `Activity · 8s` with body `Pro thinking`. With the trigger also a candidate for `Activity`, the word would carry three meanings (trigger / header / body heading). Any label decision must reconcile all three. These labels are not provider-neutral or capability-neutral enough for a multi-provider app (and `Pro thinking` is tier-false on free models). Note also the duplicated `ActivityPanelProps` type (two declarations) is a drift risk for these strings.

### Announcement Copy (Screen-Reader Phase Changes)

The Accessibility section asserts coarse SR phase announcements as required behavior, but **no `aria-live`/`role=status` region exists today** (grep across `app/components/chat` finds none), and the live trigger's `aria-label` is computed once as "Open activity: Thinking" and never re-announced when it flips to "Thought for X" — so SR users get nothing or a stale label. These announcement strings ("Thinking started", "Generating answer", "Approval required", "Stopped") are user-facing copy that must obey the same Tier-A capability gate as the visual labels (avoid "Thinking" for non-reasoning turns even in the SR channel) and must be written and enumerated, not assumed to exist.

## Timer Research

### What Timer Represents

There are several possible timers:

- wall-clock time from send to first answer token,
- wall-clock time from first reasoning delta to first text delta,
- wall-clock time while visible reasoning parts stream,
- provider-reported hidden reasoning duration,
- total generation duration.

Current runtime timer:

- starts on first visible `reasoning-delta`,
- freezes when text starts or finish happens,
- persists as `reasoningDurationMs`.

Research concern:

This is a visible-reasoning timer, not a hidden-reasoning timer. A hidden reasoning model may never emit `reasoning-delta`.

### Duration-Kind Gates Label-Kind (Tier A)

The current/only timer measures first-`reasoning-delta` → first-`text-delta`. For the providers the doc emphasizes, that span is wrong or absent: OpenAI/Anthropic return summaries (often a single late chunk, not a streaming reasoning lane), Claude `display:omitted` emits no `thinking_delta` (signature only), and Grok-4 hides reasoning. There, `reasoningDurationMs` is either never set or reflects mostly the wait before first text — so `Reasoned for X` would attach a reasoning verb to network/queue latency. Rule: `Reasoned for X` may be used **only** when the measured duration is a genuine visible-reasoning duration (non-empty reasoning text streamed); for hidden/omitted/summary-only/no-delta turns the completed label must not claim reasoning.

### Multi-Step / Interleaved Reasoning (under-researched)

The runtime freezes duration on the **first** `text-delta` after reasoning and `useReasoningPhase` models a single `idle → thinking → complete` arc. But real reasoning models interleave multiple reasoning blocks with tool calls and text across steps (the OpenAI adapter enforces `reasoning → tool → result` triples per step; multiple reasoning blocks ⇒ multiple parts keyed by `id`). Open: across N reasoning segments separated by tool calls, is duration the sum of reasoning spans, the first span only, or wall-clock to first text? Does a post-tool reasoning burst reopen the thinking phase? The current single-transition freeze is unproven against this case and will surface as a wrong `Reasoned for X` on agentic turns. Requires a captured `reasoning → tool → reasoning → text` fixture per reasoning-capable provider.

Questions for implementation planning:

- Should timer-only hidden reasoning start at submit time or after a short grace delay?
- Should the app persist timer-only durations when no visible reasoning delta exists?
- Should a hidden timer be shown for models that are known reasoning models but where request shaping did not enable reasoning?
- Should duration be displayed for historical hidden reasoning if the only evidence is send-time policy?
- Should duration survive abort/failure if no assistant message remains?

## Durable Metadata Research

Durable metadata likely needs to answer:

- What model/provider generated this turn?
- What reasoning capability did the app believe the model had at send time?
- What reasoning request policy was actually sent?
- Was reasoning display expected?
- Did displayable reasoning parts arrive?
- Was hidden reasoning observed through usage/provider metadata?
- What duration was measured and what does it measure?
- Was there a fallback/downgrade?
- Is displayable reasoning safe for public/share rendering?

Research concern:

Current `metadata.reasoningDurationMs` is durable for completed turns, but it lacks units semantics beyond comments and does not say whether duration came from visible reasoning, hidden reasoning, or total wait. It is not enough to answer whether reasoning happened, whether displayable content arrived, or whether any text is safe for public/share rendering.

Evidence the durable layer may need to distinguish:

| Durable fact | Source | Why it matters |
| --- | --- | --- |
| Static send-time model/provider | `messages.model`, `messages.provider`, catalog snapshot/derived capability | Historical rows must not inherit the currently selected model's capability |
| Effective reasoning request policy | request-shaping result | UI should not promise reasoning when the pipeline omitted/downgraded it |
| Reasoning occurrence evidence | visible deltas, provider usage, provider metadata, request policy fallback | Hidden reasoning can happen without displayable parts |
| Displayable exposure classification | observed parts/provider metadata/text-embedded detection | Safe summary, unsafe raw trace, encrypted/replay-only, and unknown need different rendering |
| Duration kind | visible reasoning delta duration, hidden/timer-only duration, total wait | "Reasoned for X" is misleading if X is just network wait |
| Public/share eligibility | display policy and exposure classification | Public rendering should not expose hidden or raw reasoning by accident |

Potential metadata questions:

- Should reasoning metadata live under `metadata.reasoning` rather than top-level `reasoningDurationMs`?
- Should tool metadata remain sibling data or be grouped as `metadata.tools`?
- Should public-share filtering strip reasoning metadata?
- Should old messages with only `reasoningDurationMs` be treated as legacy visible-reasoning evidence or just historical duration?

## Selected-Path And Branch Research

Selected path is the rendering source of truth:

- Server owns branches.
- Client projects server-selected path while idle/error.
- Regeneration/edit creates assistant siblings.
- Each assistant sibling can have different model/provider/reasoning metadata.

Research implications:

- Activity panel target must be turn-specific, not model-global.
- Branch switching while a response is running should not retarget a hidden panel to a now-hidden sibling.
- Historical siblings should keep their own triggers only when visible in the selected path.
- Regenerated responses should not inherit reasoning metadata from older siblings.
- Edited/resubmitted branches should not reuse live timer state from removed messages.

## Reload, Reconnect, Abort, And Failure Research

### Reload/Restore

Need distinguish:

- durable server chat restored from Convex,
- local guest chat restored from IndexedDB,
- shared public chat restored server-side,
- running stream interrupted by navigation or reload.

Research implications:

- Restored chats should never run live timers.
- Restored display should rely on persisted metadata and parts.
- Missing metadata should degrade to parts-only behavior.
- Historical messages from older contracts should not suddenly show `Thinking` because the current selected model supports reasoning.

### Abort During Hidden Thinking

Research questions:

- If no assistant message survives, should any UI status remain?
- If an empty assistant is preserved, should it say stopped before answer?
- Should timer-only hidden reasoning be persisted if user stops before first token?

### Abort During Visible Reasoning

Research questions:

- Should visible provider-safe reasoning summary remain in the panel?
- Should answer body show partial text if any?
- Should trigger label be `Stopped` or `Reasoned for X`?

### Failure Before/After Reasoning

Research questions:

- Should visible reasoning parts be preserved after failure?
- Should the panel display an error header or only the assistant message status?
- How should failed reasoning summaries appear in shared/public chats?

## Tool Activity Research

Tool activity should not be folded into reasoning:

- Tool states already exist in AI SDK parts.
- `ToolInvocation` already has distinct Review/Running/Failed/Denied/Completed states.
- Tool approvals map to durable `awaiting_approval`.
- Tool outcomes are persisted separately.

Research implications:

- The activity panel can include tools later, but it should model them as `tool_activity`, not `reasoning`.
- A non-reasoning model with tool calls can show an activity affordance without ever saying `Thinking`.
- User approval should interrupt/replace thinking copy because the system is waiting on the user, not the model.

## Accessibility Research

Behaviors to **preserve** (exist today): trigger is a button with `aria-expanded`/`aria-controls`; panel has one accessible name; shimmer uses `motion-reduce` in places.

Behaviors to **build** (verified absent today — do not assert as preserved):

- Coarse SR phase announcements (thinking started, answer started, approval required, failed/stopped). There is **no `aria-live`/`role=status` region** anywhere in `app/components/chat`, and the trigger `aria-label` is computed once and never updates from "Thinking" to "Thought for X". This is a copy gap as much as an a11y gap (see "Announcement Copy" under Copy And Disclosure).
- Timer changes must not be announced every second.
- Desktop docked panel as a landmark/region, not a modal trap; mobile/tablet sheet must trap focus and restore focus to the trigger on close.
- Reduced motion should disable shimmer, panel transitions, chip/step entrance animations; spinner-only status needs text.
- Tool approval controls must remain keyboard-accessible and not be hidden inside an optional reasoning panel.

Research concern:

Existing trigger has good ARIA basics, but the live-region announcement layer is unbuilt, so the asserted "coarse phase changes" behavior is aspirational. `ToolInvocation` uses motion components and spinning loader classes; reduced-motion behavior should be audited if tool states move into a panel.

## Mobile/Desktop Research

Current activity-panel architecture:

- Desktop uses docked flyout through `ActivityPanelHost`.
- Smaller screens use `ContentSheetShell`.
- Panel body renders into only one active shell to avoid duplicate favicon loads.

Research questions:

- Should visible reasoning auto-open on desktop, or should the trigger always require user action?
- Should hidden timer-only thinking open a panel at all?
- Should mobile ever auto-open the sheet? The safer default is no, because it steals focus and space.
- Should panel open state be sticky across turns, or should each turn require explicit disclosure?
- Should shared/public chats use the panel shell or inline static sections?

## Provider/Capability Caveat Matrix

This matrix is **documentation-derived**; until captured per-provider fixtures exist (see Fixture validity, below), every row is a hypothesis, not verified app behavior. "Live path" = what the native `@ai-sdk/*` provider streams to the client; "replay" = what the history adapter re-sends to the model (a separate, out-of-scope concern).

| Provider | Reasoning control | Displayable reasoning evidence | Known caveat |
| --- | --- | --- | --- |
| OpenAI | reasoning effort and summaries for supported models | summary only when requested/returned | hidden reasoning tokens are not displayable thoughts; replay item invariants matter; streaming terminal event is `response.reasoning_summary_part.done` (not `..._text.done`) in `@ai-sdk/openai@3.0.26` |
| Anthropic | thinking mode/budget/adaptive; `display` control **not exposed by `@ai-sdk/anthropic@3.0.41`** (adaptive\|enabled\|disabled only) | Claude 4+ returns a *summary by a different model*, not raw CoT; signatures/redacted content are not displayable | replay/signature/tool interactions; `display:omitted` (forward-looking, Opus 4.7/4.8-class — not yet catalogued) means signature-only, no `thinking_delta`; native `output_tokens_details.thinking_tokens` is an occurrence signal even when display is hidden |
| Google | `thinkingConfig` `includeThoughts`/`thinkingBudget` (2.5) and **`thinkingLevel` (present in `@ai-sdk/google@3.0.24`)**; `thinking_summaries` is REST-only (absent from the SDK) | summaries as reasoning parts when returned | thought signatures and strict history structure; app currently sends only `includeThoughts:true` |
| xAI | reasoning effort | per-**model**: hidden, raw, summary, or unknown | provider-level displayability is too coarse; **live path** (native `@ai-sdk/xai`) emits `reasoning_content` as reasoning-delta parts (also has an encrypted-reasoning concept) — only the **replay** adapter drops reasoning |
| OpenRouter | model/route-specific reasoning options; `/api/v1/models` exposes a per-model `reasoning` object (probe, don't hardcode) | typed `reasoning_details[]` may be text, summary, encrypted, or absent | wrapper/provider route caveats; branch on observed `type`, not provider name; replay reuses the prefix-resolved underlying provider's adapter |
| Perplexity | reasoning model SKUs (catalog marks them `reasoningText: false`) | arrives inline as `<think>...</think>` answer content; `@ai-sdk/perplexity@3.0.17` emits **zero** structured reasoning parts | always-on, cannot be suppressed; text-embedded reasoning is unsafe until stripped at the durable write boundary |
| Mistral | native `@ai-sdk/mistral` provider | **live path** converts API "thinking" chunks to structured reasoning parts (no raw `[THINK]` leak) | the "drops reasoning" behavior is the openai-compatible **replay** adapter only; raw `[THINK]`/`ThinkChunk` is the prompt-template form, not the SDK streaming output; all catalog Mistral entries are `reasoningText: false` |

## Risk Register

| Risk | Why It Matters | Research Direction |
| --- | --- | --- |
| `reasoningText` overloading | It drives request shaping and UI assumptions but does not encode hidden vs displayable reasoning | Split capability, request policy, and display policy |
| Pending state equals Thinking | Violates requirement for non-reasoning models | Pending status needs model/request capability |
| Visible reasoning timer only | Hidden reasoning models may have no visible deltas | Decide timer semantics and metadata source |
| Provider raw thought leakage | Multi-provider APIs differ and may expose internal artifacts | Display only provider-safe summaries/activity |
| Text-embedded reasoning leakage | Reasoning can arrive as normal answer text and bypass reasoning-part gates | Treat `<think>`/trace formats as unsafe until stripped or normalized |
| Reasoning transport exposure | `sendReasoning` gates only **structured parts** — it does NOT gate text-embedded reasoning in `content` | Two independent boundaries: structured-parts transport vs content-sanitization at the durable write; hardening `sendReasoning` does nothing for the content channel |
| Replay invariants | Reasoning parts can be structurally required for future requests | Keep provider logic out of components |
| Historical drift | Model registry changes can alter old message display if UI reads current model | Persist send-time metadata |
| Branch/sibling confusion | Regeneration and edits create multiple assistant alternatives | Activity state must be message/turn-scoped |
| Shared chat content leak | The share article renders persisted `content` directly and omits `metadata`; the live exposure is unsanitized text-embedded CoT and frozen partial text, NOT reasoning metadata | Sanitize `content` at the durable write boundary; gate public projection to terminal status |
| Shared incomplete-turn exposure | Public read filters only `awaiting_approval`; `streaming`/`aborted`/`failed` frozen partials render publicly with no indicator and no sanitization guarantee | Terminal-status gating before planning, not a cosmetic badge |
| Local guest divergence | Local snapshots may lack new metadata | Decide local metadata parity |
| Unknown providers | Wrapped/provider-compatible models may not have stable semantics | Default unknown to no Thinking |

## Test Research Inputs

These are not implementation tasks. They are behavior questions a plan should prove with focused tests.

### Fixture Validity (prerequisite — the current fixtures are invalid)

The doc leans on "fixtures" as the resolver for nearly every display-safety question, but the only reasoning fixtures in the repo are **mis-shaped**: `app/api/chat/adapters/__tests__/fixtures.ts` authors reasoning parts as `{ type: "reasoning", reasoning: "…", state: "done" }` — the removed **v4** field name. The installed `ai@6.0.78` `ReasoningUIPart` is `{ type: "reasoning", text: string, state?, providerMetadata? }`. Any rendering/normalization test built on the existing fixtures passes against fiction and must be re-captured against the v6 `text` shape before it is trusted.

A fixture must also declare **which wire layer** it represents, because the field names and gating differ:

- provider raw SSE,
- AI SDK `fullStream` parts (reasoning delta field is `.text`),
- UI-message **wire** chunks (reasoning delta field is `.delta`; mapper does `delta: part.text`),
- durable `messages.parts` / `messages.content`.

**Evidence to capture before planning** (one fixture per provider/representative-model/mode; record the AI SDK `fullStream` + UI-message wire stream for a fixed prompt and commit it so tests need no live API): Anthropic adaptive (summarized vs — forward-looking — omitted), OpenAI `reasoningSummary:auto`, Gemini `includeThoughts`, Grok raw vs hidden vs summary (by model), Perplexity sonar-reasoning (`<think>` inline), Mistral Magistral, one OpenRouter wrapped route, and one **multi-step** `reasoning → tool → reasoning → text` turn. Until these exist, every row of the Provider/Capability Caveat Matrix is a hypothesis. Privacy: prefer **synthetic** `<think>`/`[THINK]` payloads — real captured CoT embeds the user's prompt verbatim and provider-gated traces (see Security note in Open Questions), so a real-CoT corpus needs its own access-control/retention decision.

### Capability/State Derivation

- Does a non-reasoning model in submitted state produce no `Thinking` label?
- Does an unknown-capability model avoid `Thinking` even while waiting?
- Does a hidden-reasoning model produce timer-only state without panel content?
- Does a displayable-reasoning model upgrade from timer-only to panel content when reasoning parts arrive?
- Does text-embedded reasoning stay out of the answer body until stripped/normalized/classified?
- Does a tool-only turn produce `Activity`/tool labels, not `Thinking`?
- Does approval-required override thinking/tool-running labels?
- Does provider fallback/downgrade change the display policy?

### Runtime/Metadata

- Does request shaping produce reasoning controls independently from display eligibility?
- Does stream metadata distinguish visible reasoning duration from hidden/timer-only duration?
- Does durable persistence keep send-time capability and effective policy?
- Does durable persistence record observed exposure classification separately from static capability?
- Do old messages with missing reasoning metadata degrade safely?
- Does public/shared projection strip or include reasoning metadata according to product policy?

### Component Rendering

- Pending non-reasoning assistant row.
- Pending hidden-reasoning assistant row.
- Visible reasoning streaming and completed states.
- Empty/opaque reasoning parts.
- Text-embedded reasoning markers in assistant text.
- Reasoning interleaved with text deltas.
- Reasoning summary arriving only at finish.
- Tool running/completed/failed/denied.
- Approval-required.
- Aborted/failed before and after partial reasoning.
- Historical restored message with fixed duration.
- Multiple assistant siblings with one selected path.

### Browser QA Scenarios

- Non-reasoning model delayed first token: no `Thinking`.
- Hidden reasoning delayed first token: timer/status only.
- Visible reasoning model: trigger and panel update while answer streams.
- Stop during hidden timer-only state.
- Stop during visible reasoning state.
- Tool approval flow: review state is primary and not labeled as thinking.
- Regenerate response and switch branches while a panel is open.
- Reload completed chat and verify no live timer.
- Shared read-only chat rendering.
- Shared read-only chat with text-embedded reasoning fixture.
- Local guest chat reload.
- Mobile sheet focus/restore and desktop docked panel behavior.
- Reduced-motion pass.

## Cross-Cutting Research Gaps

Areas that should be investigated before a plan but are otherwise thin in this document:

- **Reasoning-specific error taxonomy.** Map reasoning-specific failures (`pause_turn`, content filter on a thinking block, budget exhaustion, signature/continuity errors) to the durable `status`/`error` fields. The terminal mutation patches `status`+`error` only and **deletes empty-parts assistants entirely**, so some "failed during hidden reasoning" cases leave no row — this bounds which UI State Matrix failure rows are reachable.
- **i18n / RTL.** The repo has **no** i18n framework (no `i18next`/`react-intl`/`next-intl`). Every candidate label is hard-coded English and durations use a `formatDuration` template. Decide whether labels are localizable, how durations/source-counts are formatted and pluralized per locale, and whether the trigger mirrors under RTL. At minimum, keep label and duration as **separable tokens**, not a baked English template.
- **Telemetry vs durable metadata.** `reasoningDurationMs` already flows to Sentry/Braintrust at finish but is non-queryable for rendering. Render-driving facts must live in `messages.metadata`; do not assume telemetry can drive rendering or duplicate it into durable metadata blindly. Separately decide what reasoning analytics the product wants (occurrence rate, omitted-display frequency, summary-opt-in latency).
- **Cost & latency of reasoning.** Reasoning tokens are billed as output across providers; opting into summarized display or higher effort trades latency/cost for visible reasoning. Require a **measured** time-to-first-token delta for `summarized` vs `omitted` (captured, not assumed) before committing to opt-in, and decide whether reasoning token cost is surfaced to users.
- **Per-token render performance.** A derivation function called per `reasoning-delta` over a long reasoning stream (thousands of tokens before any text) is a hot path. Require a long-reasoning fixture to measure per-delta re-derivation and panel re-render, and decide whether the derivation must be memoized/throttled. (The body's "already accounted for" covers memoization identity, not reasoning-stream throughput.)
- **Share-link revocation / caching.** Whether un-publishing (`chat.public → false`) immediately revokes access, and whether CDN/edge caching of the share page can leak after revocation.

## Open Questions

Not all of these block a plan. **Blocking** (must be answered before the capability/state machine can be specified): Technical #1 (where capability lives), #5 (which providers populate reasoning-token usage — the occurrence signal), #9 (text-embedded sanitization boundary), the exposure-classification fallback precedence (Addendum #4), and the share content/terminal-status policy (Product #4 for security). **Deferrable** (product/UX judgment behind the capability seam): most of Product #1–3, #5–8. One question is **already answered** by verification and should be downgraded: whether `@ai-sdk/anthropic` exposes the `display` knob (Addendum #1) — it does not on `3.0.41`.

### Product

1. Should the product display provider-returned reasoning summaries directly, or only behind an activity/disclosure surface?
2. Should OpenAI reasoning summaries be displayed under `Reasoning summary`, `Activity`, or hidden behind a disclosure by default?
3. Should hidden reasoning timer-only status be visible during generation, after generation, both, or neither?
4. What should public shared chats expose: reasoning summaries, tool activity, sources only, or answer content only?
5. Should mobile auto-open the activity sheet for visible reasoning, or always require explicit user action?
6. Should the trigger copy prefer `Reasoned for X` over `Thought for X`?
7. Should provider caveats ever be user-visible, or only developer/debug metadata?
8. Should withheld/encrypted reasoning show a generic note, or be silent?

### Technical

1. Where should normalized model capability live: directly in `ModelConfig`, in a derived model-capability module, or as provider-specific registry overlays?
2. Should request shaping return both `providerOptions` and an `effectiveReasoningPolicy` object?
3. Should `sendReasoning` stay globally true with server-side filtering, or should it be gated before stream transport?
4. How should hidden reasoning duration be measured when no `reasoning-delta` exists?
5. Which providers reliably populate normalized reasoning-token usage (read off the server `fullStream`/`onFinish`, not the UI-wire finish chunk; canonical path is `usage.outputTokenDetails.reasoningTokens`, top-level `usage.reasoningTokens` is deprecated in `ai@6.0.78`), and how should missing provider usage degrade? **Blocking** — gather this evidence, do not assume normalization implies population.
6. Should local guest snapshots persist the same reasoning metadata as Convex messages? (Note: stream-level `reasoningDurationMs` already reaches guest clients, so parity is smaller than framed.)
7. How should older messages with only top-level `reasoningDurationMs` be interpreted?
8. Should tool activity move into the activity panel, remain inline, or have both surfaces?
9. How should text-embedded reasoning be detected, stripped, normalized, and fixture-tested **at the durable write boundary** (so it never reaches `messages.content`, which the public share path reads) — and what is the migration story for already-persisted `<think>` content? Does `extractReasoningMiddleware({ tagName: "think" })` sit upstream of the durable text-delta accumulator? **Blocking** for the share surface.
10. How should OpenRouter wrapped models declare per-base-model caveats without exploding the model catalog?
11. What is the right testing fixture strategy for provider reasoning streams without calling live APIs?

## Planning Inputs, Not A Plan

The implementation plan should probably be constrained by these research findings:

- UI components should not branch on provider names.
- Model metadata should not use one boolean for support, request policy, and display policy.
- Runtime normalization should persist send-time capability/effective policy because historical rendering cannot rely on current catalog metadata.
- The presentation state should be derived by a small function from normalized capability, message status, parts, tool state, sources, and durable metadata.
- Tool activity, source citations, and reasoning should remain distinct.
- Unknown capability should default to no `Thinking`.
- Displayable reasoning must mean provider-safe summary/activity content, not raw hidden chain-of-thought.
- Text-embedded reasoning must be treated as unsafe until normalized or stripped **at the durable write boundary** (the share path renders persisted `content`, not the private render tree).
- There are **two** independent safety boundaries: (1) structured reasoning parts — governed by `sendReasoning` transport + render-time display policy; (2) text-embedded reasoning in `content` — governed only by content sanitization at the durable write. Hardening `sendReasoning` does nothing for boundary (2).
- Static model capability is a prediction; runtime-observed exposure should win for the persisted assistant turn.
- Existing selected-path architecture should remain the authority for which assistant turn is visible and which sibling owns activity state.

## Appendix: Repo Reference Points

- `CONTEXT.md`: domain language for Chat turn runtime, selected path, branch projection, message metadata, provider strategy, and request shaping.
- `docs/adr/0006-chat-turn-runtime.md`: accepted architecture for route/runtime split.
- `lib/models/types.ts`: current `ModelConfig` shape.
- `lib/models/data/*.ts`: current model capability flags.
- `lib/openproviders/request-shaping.ts`: provider request policy seam.
- `lib/openproviders/request-shaping.test.ts`: current request-shaping invariants.
- `app/api/chat/chat-turn-runtime.ts`: streaming, reasoning duration, UI message response, durable completion.
- `app/api/chat/adapters/*`: provider history adaptation and reasoning replay constraints.
- `convex/schema.ts`: message/generation status and durable message fields.
- `convex/lib/messageMetadata.ts`: persisted metadata validator/projector.
- `lib/chat-messages/metadata.ts`: client metadata ownership module.
- `lib/chat-store/turns/selected-path.ts`: selected-path projection source of truth.
- `app/components/chat/use-chat-core.ts`: AI SDK `useChat`, stop/reload/projection lifecycle.
- `app/components/chat/use-activity-panel.ts`: activity-panel target ownership.
- `app/components/chat/use-reasoning-phase.ts`: current reasoning-part phase/timer derivation.
- `app/components/chat/message-assistant.tsx`: current activity trigger, loading, status rendering.
- `app/components/chat/tool-invocation.tsx`: current tool state rendering.
- `app/components/chat/activity/*`: current panel/trigger/shell implementation.
- `app/share/[chatId]/article.tsx`: public shared rendering path.
- `app/test/thinking-states/page.tsx`: existing manual state reference surface, now partially stale relative to activity-panel work.

---

# Addendum — Deep Investigation Findings (2026-06-28)

This addendum was produced by a separate, deeper investigation pass: parallel first-hand reads of every subsystem named above, official-doc research across AI SDK v6 + all six providers, and **adversarial verification** of risky claims against the actual code and the installed `node_modules`. It is additive to the body above and provides source-verified details that are too granular for the main research flow.

It remains a research artifact, not an implementation plan: no sequencing, no final APIs, no migration. Read it as "things we now know for certain, footguns to avoid, and questions worth resolving before planning."

> **How to read this Addendum.** It inherits the body's altitude rubric and the body's line-540 refusal to pre-commit to TypeScript shapes. Where bullets below name a field, a function, a test signature, or use "must"/"should," treat them as **illustrative findings/hypotheses**, not decisions — the decisions belong in Open Questions. SDK claims are pinned to `ai@6.0.78` and the installed `@ai-sdk/*` versions; where a claim is true only on the `vercel/ai` v7/`main` line it is flagged as such. Model-version facts (Opus 4.7/4.8, Fable 5, grok-4.3) are **forward-looking** — real and provider-documented but not in the current catalog (newest catalogued Claude is Opus/Sonnet 4.6).

## Verified durability and replay details

These three details are load-bearing. They define the current risk profile for reload, persistence, abort, and failure behavior.

1. **`reasoningDurationMs` is durably persisted and survives reload for completed turns.** The "client-transient" framing is only true relative to the *server-owned-projection* writers (`stampServerFields` / `adoptServerOwned` in `lib/chat-messages/metadata.ts`), which do not own that field. In reality it is a first-class field of `vToolInvocationStreamMetadata` ([convex/lib/messageMetadata.ts:45](convex/lib/messageMetadata.ts)), the `messages.metadata` column is narrowed to that validator ([convex/schema.ts:145](convex/schema.ts)), it is written on completion via `projectPersistedMessageMetadata` ([messageMetadata.ts:131](convex/lib/messageMetadata.ts)), and the reload adapter preserves it because `clearServerOwnedMetadata` deletes only its own 8 keys ([metadata.ts:132-136](lib/chat-messages/metadata.ts)). A reloaded completed turn can therefore show duration-derived copy. Anyone planning the durable layer should not "add" duration persistence as if it were absent; the gap is occurrence/exposure semantics.

2. **Reasoning *text* persists verbatim and reconstructs on reload.** `messages.parts` is `v.any()` ([convex/schema.ts:126](convex/schema.ts)) and `onFinish` writes `responseMessage.parts` wholesale; because `sendReasoning: true` ([chat-turn-runtime.ts:1590](app/api/chat/chat-turn-runtime.ts)), reasoning parts are *in* that array. Source-level check of the installed SDK confirms the reducer accumulates reasoning parts into `responseMessage.parts`. So a reloaded completed reasoning turn reconstructs its summary text from `parts`, not just its duration. The reload story is **better than the body fears** for completed turns; the real fragility is abort/fail and hidden-no-text (below).

3. **Reasoning evidence is genuinely lost on abort/fail.** The terminal mutations route through `applyTerminalAssistantOutcome`, which patches **only** `status` + `error` ([convex/chatRuntime.ts:353-357](convex/chatRuntime.ts)), and the UI-stream `onFinish` returns early on `isAborted` *before* the only metadata-writing path ([chat-turn-runtime.ts:1611-1614](app/api/chat/chat-turn-runtime.ts)). So `reasoningDurationMs` — even though it was computed — is never persisted on a stopped/failed turn. Partial reasoning *text* may survive via the last throttled snapshot flush into `parts`; the duration does not. This is the concrete mechanism behind the abort open questions.

## Verified facts (adversarial pass)

Each row was checked against the code (and, where noted, the installed SDK). "Verdict" reflects whether the asserted claim held.

| # | Claim checked | Verdict | Key citation |
| --- | --- | --- | --- |
| 1 | Reasoning capability is one overloaded boolean `reasoningText` (+ Anthropic-only `thinkingMode`/`thinkingBudget`); no enum/object | confirmed | `lib/models/types.ts:34,44,51`; `request-shaping.ts:75` |
| 2 | `thinkingMode`/`thinkingBudget` are read **only** in the Anthropic branch; no effect on google/openai/xai | confirmed | `request-shaping.ts:79-93` |
| 3 | No dynamic/runtime catalog; `getAllModels()` is static; unknown ids **throw** (not defaulted) | confirmed | `lib/models/index.ts:37-39`; `chat-turn-runtime.ts:413-424`; `provider-map.ts:135` |
| 4 | `maxOutput`/`contextWindow` have **no runtime consumers**; the "used for thinking budget" comment is stale | confirmed | `types.ts:27-28`; `request-shaping.ts:82-85` |
| 5 | The `pause_turn` workaround is still needed in the installed SDK (not just an in-code claim) | **bug is real** | `node_modules/@ai-sdk/anthropic/dist/index.mjs:2446`; `ai/dist/index.mjs:4293` — **keep the downgrade** |
| 6 | `sendReasoning: true` forwards reasoning parts; **no** server normalization records opaque-vs-displayable | confirmed | `chat-turn-runtime.ts:1590`; `use-reasoning-phase.ts:64` (client-only `isOpaqueReasoning`) |
| 7 | Reasoning tokens are never counted/persisted; usage is strictly `{input,output,total}` | confirmed | grep zero hits; `convex/schema.ts:137-143`; `chatRuntime.ts:67` |
| 8 | Reasoning parts **are** persisted to `messages.parts` (verbatim, `v.any()`) | confirmed | `schema.ts:126`; SDK reducer `ai/dist/index.mjs:5144-5168` |
| 9 | `reasoningDurationMs` persisted on completed, **lost on abort** | confirmed | `messageMetadata.ts:45,131`; `chatRuntime.ts:353-357` |
| 10 | Under `HISTORY_REPLAY_COMPILER_V1`, normalize **drops all reasoning**; OpenAI compiler injects empty synthetic placeholders | confirmed | `replay/normalize.ts:246`; `replay/compilers/openai.ts:141,189` |
| 11 | A reasoning-only assistant turn (empty/opaque) is filtered out of model history | confirmed | `convex/domain/message_visibility.ts:18-20,79-90` |

**Incidental observations (migration/cleanup — out of research scope).** Two further checks surfaced during the pass are not reasoning-state semantics and are kept here only for completeness: (12) live event handling is provider-agnostic except one dev-only `console.log` in `onFinish` (cosmetic); (13) the schema-narrowing of `messages.metadata` is not guarded by the expand/migrate/contract tooling (a migration-readiness concern — out of scope per the "no migration plan" Non-Goal; if pursued, frame as an open question, not a finding).

**The headline defect, restated precisely:** the thinking affordance is gated on *parts-presence + `"submitted"`*, never on capability. `isSubmittedPending = status==="submitted" && isLast` drives `activityState = {status:"thinking"}` ([message-assistant.tsx:162-169](app/components/chat/message-assistant.tsx)), and the pending placeholder hard-codes `phase:"thinking", isReasoningStreaming:true` ([use-activity-panel.ts:239-248](app/components/chat/use-activity-panel.ts)). Both fire for non-reasoning models. The capability input the body asks for simply does not reach the presentation layer today.

## AI SDK v6 — precise semantics & footguns (source-verified)

The body's AI SDK section is directionally right but omits the exact shapes that prevent real bugs. Verified against `ai-sdk.dev` docs **and the installed `ai@6.0.78` dist** (`node_modules/ai/dist`). Where an earlier draft cited `vercel/ai` `main`/v7 file paths, those have been re-checked against the pin; v6-vs-v7 discrepancies are flagged inline below.

- **`sendReasoning` default is `true`** (verified in installed `ai@6.0.78`, `dist/index.mjs:7275`; the `delta: part.text` wire mapping is at `dist/index.mjs:7335`). The v7 module name `to-ui-message-chunk.ts` does **not** exist in v6 — the mapping is inline. Reasoning is forwarded to the client by default — a *transport* default, not a *display* policy. (Sibling defaults: `sendSources=false`, `sendStart=true`, `sendFinish=true`.)
- **Two different `sendReasoning` options exist and are routinely conflated:** (a) `toUIMessageStreamResponse({ sendReasoning })` forwards reasoning to the *client*; (b) `providerOptions.anthropic.sendReasoning` controls sending reasoning *back to the model* on multi-turn. Different surfaces, both default true.
- **Field-name footgun (will bite normalization code):** in `fullStream`, the reasoning-delta content field is **`.text`**; on the UI-message **wire** protocol the same chunk uses **`.delta`** (the mapper does `delta: part.text`). Published *types* once asserted `.delta` for `fullStream` while runtime emits `.text` ([issue #8756](https://github.com/vercel/ai/issues/8756)). Treat `.text` as correct for `fullStream`.
- **`ReasoningUIPart` exact shape:** `{ type: "reasoning"; text: string; state?: "streaming" | "done"; providerMetadata?: ProviderMetadata }`, living inside `UIMessage.parts[]` (the v4 top-level `message.reasoning` was removed; the field was renamed `reasoning`→`text`). Multiple reasoning blocks ⇒ multiple parts interleaved with text parts; key by `id`, don't assume a single block.
- **`usage.reasoningTokens` is SDK-normalized**, but two caveats matter for the pin: (1) in `ai@6.0.78` the **top-level `usage.reasoningTokens` is `@deprecated`** in favor of `usage.outputTokenDetails.reasoningTokens` (both populated); (2) it is on the `fullStream` finish part / `result.usage` but **not on the UI-message wire finish chunk** (which carries only `finishReason` + optional `messageMetadata`) — so it must be read **server-side** (`onFinish`/`fullStream`), not from the client stream. It is the candidate "reasoning happened" signal for hidden-no-text turns, but "normalized cross-provider" ≠ "every provider populates it" — gather per-provider evidence (open Q #5). Anthropic also exposes native `usage.output_tokens_details.thinking_tokens` as a cross-check.
- **Portable `reasoning` request param** (`"none"|"minimal"|"low"|"medium"|"high"|"xhigh"`) is a **v7-only** normalized effort knob — it is **absent from the pinned `ai@6.0.78`** (no `xhigh`/`minimal` anywhere in `node_modules/ai/dist`). Exposing a portable user effort control would require an SDK upgrade; today only provider-native `providerOptions` effort knobs exist.
- **`extractReasoningMiddleware({ tagName: "think" })`** is exported by `ai@6.0.78` and re-exposes inline `<think>`-tagged reasoning (DeepSeek/Perplexity-style) as proper reasoning parts. It is a *candidate* seam, not a proven fix: it is **not installed** today, and the safety question is **layer placement** — it must intercept **upstream of the durable text-delta accumulator** (`durable-runtime.ts`) so stripped `<think>` never reaches `messages.content` (which the public share path reads); render-time use does not stop the public leak. Open: migration story for already-persisted `<think>` content, and non-destructiveness for legitimate user text containing the literal token.
- **Resumable streams** (`useChat({ resume: true })` + `createResumableStreamContext`) are documented, and **`resume` and `stop()`/abort are mutually exclusive**. For this repo they are effectively unavailable: `createResumableStreamContext` is **not exported by the installed `ai` package** and the `resumable-stream` dependency is not installed. The app is not resumable client-side: `consumeStream` keeps the *server* writing durable snapshots after disconnect, and the client re-hydrates the frozen durable snapshot on reload. Any "resume the live thinking stream" idea collides with the existing stop/abort behavior and would require a new dependency.

## Provider semantics — the details the body's matrix lacks (with exact wording)

The body's per-provider sections are good summaries; these are the *load-bearing specifics* that change behavior, with the providers' own wording.

- **Anthropic returns a SUMMARY, not raw CoT, on Claude 4+.** Verbatim: "the Messages API for Claude 4 models returns a summary of Claude's full thinking process. Summarized thinking provides the full intelligence benefits of extended thinking, while preventing misuse." The summary is produced by a *different* model; raw full thinking is gated behind contacting Anthropic. So "Anthropic returned a thinking block" already means "a summary," not raw CoT.
- **Claude `display` defaults (forward-looking; settled SDK constraint).** Anthropic documents `thinking.display` ∈ `"summarized" | "omitted"`, defaulting to `"summarized"` on Opus 4.6 / Sonnet 4.6 and earlier Claude 4, and `"omitted"` on later Opus 4.7/4.8-class models (which stream `signature_delta` only, no `thinking_delta`). **These newer models are not in the current catalog** (newest is Opus/Sonnet 4.6, which default to summarized), so there is **no current opaque-reasoning gap** — this is a constraint to honor *when the catalog advances*, not a present defect. Settled fact (verified, not an open question): the pinned **`@ai-sdk/anthropic@3.0.41` does NOT expose the `display` knob** (its `thinking` option is `adaptive | enabled | disabled` only; model-id enum stops at `claude-opus-4-6`). So opting into `summarized` on any future Opus 4.7/4.8-class model is **blocked on an SDK upgrade**, regardless of product preference.
- **Anthropic opaque blobs — never render:** `signature` ("an opaque field [that] should not be interpreted or parsed") and `redacted_thinking` `data` ("encrypted content that isn't human-readable"). Anthropic's own UI guidance: filter redacted blocks, optionally show a generic "some reasoning was encrypted for safety" note. (Claude 4 models don't emit `redacted_thinking`; it was a 3.7-era behavior.)
- **Faithfulness caveat (affects copy):** Anthropic states the thinking text "[doesn't necessarily] truly represent[] what's going on in the model's mind." Displayed reasoning should be framed as *the model's stated reasoning*, never as an authoritative/complete explanation. This argues against anthropomorphic copy.
- **OpenAI never returns raw CoT.** Verbatim: "we don't expose the raw reasoning tokens emitted by the model"; "reasoning tokens are not visible via the API." Only `reasoning.summary` (`auto|concise|detailed`) is displayable. The app already requests `reasoningSummary:"auto"` ✓. `encrypted_content` is round-trip-only, never displayable. Streaming summary events in `@ai-sdk/openai@3.0.26`: `response.reasoning_summary_text.delta`, with the terminal event being `response.reasoning_summary_part.done` (there is no `..._text.done`).
- **Gemini: two doc generations diverge.** 2.5-era uses `thinkingConfig { thinkingBudget, includeThoughts }`; **3.x-era replaces budget with `thinking_level` (low/medium/high) and `thinking_summaries ("auto"|"none")`**. Resolved against the pin: the installed **`@ai-sdk/google@3.0.24` already exposes `thinkingLevel`** (minimal/low/medium/high) in `thinkingConfig` — the 3.x effort knob is usable today **without** an SDK bump — but it has **no `thinking_summaries` field** (REST-only). The app currently sends only `includeThoughts:true` (2.5-era). `thought_signature` is an opaque continuity token.
- **Grok exposure varies by *model*, not provider** (forward-looking ids noted): grok-3-mini exposes **raw** `reasoning_content`; grok-4 reasons but **hides** it; grok-4.3 (documented, not yet catalogued — current entries are `grok-4-0709`/`grok-4-1-*`) exposes **summaries**. So a single provider-level `disclosure` is wrong for xAI — it must be per-model (or runtime-observed). Note the **live** native `@ai-sdk/xai` path emits `reasoning_content` as reasoning-delta parts; only the replay adapter drops them.
- **Perplexity** emits reasoning **inline as `<think>…</think>` in content**, always-on, and it **cannot be suppressed** (even `response_format` leaves it in) — and it does **not** arrive as AI SDK reasoning parts without middleware. Today it would leak into the answer body.
- **Mistral Magistral**: the raw `[THINK]`/`ThinkChunk` trace is the prompt-template form. On the **live** path the repo uses the native `@ai-sdk/mistral` provider, which converts API "thinking" chunks into structured reasoning parts (no raw `[THINK]` leak); the "drops reasoning" behavior is the openai-compatible **replay** adapter only. (All catalog Mistral entries are `reasoningText:false`, so request-shaping sends nothing for them anyway.)
- **OpenRouter** normalizes to `reasoning_details[]` whose entries are typed **`reasoning.text | reasoning.summary | reasoning.encrypted`** — the *same field can be raw, summary, or encrypted depending on upstream*, so branch on `type`, never on provider name. Critically, **OpenRouter `/api/v1/models` reports a per-model `reasoning` capability object** (`supported_efforts`, `default_effort`, `mandatory`, …) — the concrete answer to the body's "how do wrapped models declare per-base-model caveats without exploding the catalog" question: probe, don't hardcode.

**Net taxonomy implication (finding, not a field spec):** Grok exposure varies per model and OpenRouter per upstream route, so a provider-level disclosure flag is demonstrably wrong. The capability model **likely needs** (a) a per-model static prediction of disclosure and (b) a durable record of observed exposure, with runtime observation taking precedence. The field names (`disclosure`, `reasoningExposure`), enum values, and precedence order are an **open design question** for the plan, not settled here (the body's line-540 refusal to pre-commit governs).

## A catalog-vs-pipeline reasoning mismatch (research finding + open question)

**Finding.** The catalog can mark a model `reasoningText: true` while request shaping emits no reasoning options for it, so the UI would promise a thinking affordance the pipeline never produces. **Corrected scope (this contradicted an earlier draft and the body):** of the catalog's reasoning concerns, only **OpenRouter** actually exhibits this divergence — its two `reasoningText: true` entries ([openrouter.ts](lib/models/data/openrouter.ts)) hit `default: {}` because `providerId "openrouter"` is not a switch case in `resolveProviderOptions` ([request-shaping.ts:77-96](lib/openproviders/request-shaping.ts)). **Mistral and Perplexity do NOT exhibit it**: every Mistral and Perplexity catalog entry is `reasoningText: false`, so they short-circuit at `request-shaping.ts:75` and never reach `default: {}` (consistent with the body, which states this correctly). The providers that emit reasoning options are exactly the non-`default` switch cases: anthropic / google / openai / xai. (The `reasoningText: true` mistral case in `request-shaping.test.ts` is a synthetic test fixture, not a catalog entry — likely the source of the earlier over-generalization.)

**Open question (not a prescribed test).** How should the capability layer reconcile catalog reasoning claims against what request shaping actually emits — and where should that check live? One candidate is a static contract test (does every `reasoningText: true` model resolve to a non-`default` switch case?), which against today's catalog would flag OpenRouter only. The divergence is **deterministic per model** (computable from catalog + switch cases), so it does not by itself justify a per-turn durable "effective policy" field; the only genuinely per-request variation is the Anthropic search-active `adaptive → enabled` downgrade. (Function names like `capability.surfacesReasoning` are illustrative, not a prescribed API.)

## A reasoning-replay boundary the capability layer must NOT absorb

"How prior reasoning is replayed to the model" is decided by a single **flag + provider-selected** dispatch with three possible mechanisms — and it is *not* the same concern as "how thinking is displayed":

1. Legacy per-provider adapters — drop reasoning for default/text-only/openai-compatible, keep for anthropic, triple-enforce reasoning→tool→result for openai (`app/api/chat/adapters/*`).
2. The replay-compiler `normalize` stage (`HISTORY_REPLAY_COMPILER_V1`) — drops **all** reasoning, then the OpenAI compiler re-injects empty synthetic placeholders for structural invariants (`app/api/chat/replay/*`, verified #10).
3. The OpenAI post-convert plaintext fallback — strips reasoning + tools (in fact all non-text content) for response-id-linked replays (`app/api/chat/utils.ts` `toPlainTextModelMessages`).

Mechanisms #1 and #2 are **mutually exclusive** (the flag selects one). Under the flag, compilers are registered **only for openai and anthropic** — every other provider throws and falls back to the legacy adapter, so the normalize-drops-all + synthetic-injection behavior is effectively openai/anthropic-specific, not universal. A capability/display layer that also tried to own replay drop/keep would balloon in scope and duplicate provider logic in the wrong place. **Implication:** replay drop/keep is already a server-side provider concern; the display layer should consume normalized parts/metadata and not influence what history is re-sent. (Whether to formally scope replay out is a plan decision.)

## Additional open questions (surfaced by this pass)

These extend the body's Open Questions; they're new or sharper.

1. **Claude `display` — partially settled, downgrade from blocking.** Verified: the pinned `@ai-sdk/anthropic@3.0.41` does **not** expose the `display` knob, and no Opus 4.7/4.8-class model is catalogued. So for current-catalog planning there is nothing to decide; the residual question (opt into `summarized` vs accept opaque) only arises *after* an SDK upgrade adds a model whose default is `omitted`.
2. **Occurrence signal (neutral):** should the app derive a durable "hidden reasoning happened" signal from provider usage? The SDK exposes a normalized reasoning-token count — but in pinned `ai@6.0.78` the canonical path is `usage.outputTokenDetails.reasoningTokens` (top-level deprecated), it is read server-side off `fullStream`/`onFinish` (not the UI-wire finish chunk), and per-provider population is unverified. Trade-off: a durable occurrence signal independent of emitted deltas vs. added persistence surface and provider-coverage uncertainty. (Privacy upside: token counts prove "reasoning happened" without persisting any CoT text.)
3. **Abort persistence (neutral):** flush reasoning occurrence/duration on abort, or accept the loss and derive disclosure from replayed `parts`? Trade-off only — the mechanics are understood (duration lost on abort; partial text may survive via `parts`; empty-parts rows are deleted).
4. **Exposure classification fallback precedence:** when a provider omits `reasoningTokens`, what is the exact fallback order for "did reasoning happen" — `tokens>0` → `duration>0` → parts-present → absent? This needs to be pinned to avoid misclassifying hidden-vs-none.
5. **Grok/OpenRouter per-model disclosure:** resolve `disclosure` per model (Grok) or by probing OpenRouter `/api/v1/models`, rather than a provider-level constant?
6. **Withheld/redacted copy:** show a generic "reasoning withheld/encrypted" note, or render silently? (The blob is never rendered either way — this is a copy decision, not architecture.)
7. **Same-chat branch switch while streaming** does not call `stop()` and the projection is gated on `ready`/`error`, so the switch has no visible effect until the stream settles — is that the intended UX, or a latent surprise vs. chat-to-chat nav (which does stop)?
8. **Share page incompleteness:** public reads filter only `awaiting_approval`; `streaming`/`aborted`/`failed` durable states render their frozen partial text with **no indicator**. Should shared chats badge incomplete turns?

## Curated resource index

Official sources gathered during this pass, organized by topic. Each was fetched/verified on 2026-06-28.

**AI SDK (the normalized layer) — repo pins `ai@6.0.78`; `ai-sdk.dev` docs default to the v7 "Latest" line, so confirm each behavior against the installed dist:**
- [Reasoning (portable param, precedence, provider support)](https://ai-sdk.dev/docs/ai-sdk-core/reasoning) — **v7 page**; the portable `reasoning` effort enum it documents is NOT in pinned v6.0.78.
- [streamText reference (fullStream parts, onFinish, usage, toUIMessageStreamResponse options)](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [UI stream protocol (reasoning-start/delta/end wire shapes)](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [UIMessage reference (ReasoningUIPart shape)](https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message)
- [Chatbot Resume Streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams) · [Troubleshooting: abort breaks resumable streams](https://ai-sdk.dev/docs/troubleshooting/abort-breaks-resumable-streams) — note `createResumableStreamContext` is not exported by the installed `ai`, and `resumable-stream` is not a repo dependency.
- [AI Elements: Reasoning component (the intended display surface)](https://elements.ai-sdk.dev/components/reasoning)
- [Migration 4.x→5.0 (`.reasoning`→`.reasoningText`, reasoning moved into parts[])](https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0)
- **Pinned-version source of truth** (preferred over `vercel/ai` `main`/v7 paths): installed `node_modules/ai/dist/index.mjs` — `sendReasoning = true` default at `:7275`, `delta: part.text` wire mapping at `:7335`. (The v7 module `to-ui-message-chunk.ts` does not exist in v6.) · [issue #8756](https://github.com/vercel/ai/issues/8756) (`.text` vs `.delta` footgun)

**Anthropic (summary-not-raw; display omitted/summarized; encryption):**
- [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) · [Adaptive thinking (effort, display defaults, token accounting)](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- [Streaming (thinking_delta, signature_delta, display:omitted)](https://platform.claude.com/docs/en/api/messages-streaming) · [Stop reasons (pause_turn)](https://platform.claude.com/docs/en/api/handling-stop-reasons)
- [Thinking encryption / redacted_thinking (Bedrock, Anthropic-authored)](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-thinking-encryption.html) · [Visible extended thinking — raw-vs-summary rationale + faithfulness caveats](https://www.anthropic.com/news/visible-extended-thinking)
- [AI SDK Anthropic provider (thinking budgetTokens, signature, sendReasoning)](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)

**OpenAI (raw CoT never returned; summaries only):**
- [Reasoning models guide](https://platform.openai.com/docs/guides/reasoning) · [Reasoning best practices](https://platform.openai.com/docs/guides/reasoning-best-practices)
- [Responses streaming events (`reasoning_summary_text.delta/.done`)](https://developers.openai.com/api/reference/resources/responses/streaming-events) · [Migrate to Responses API](https://platform.openai.com/docs/guides/migrate-to-responses)
- [AI SDK OpenAI provider (reasoningEffort, reasoningSummary, encrypted_content)](https://ai-sdk.dev/providers/ai-sdk-providers/openai)

**Google / xAI / Perplexity / Mistral / OpenRouter:**
- [Gemini Thinking (2.5 thinkingConfig + 3.x thinking_level/thinking_summaries)](https://ai.google.dev/gemini-api/docs/thinking)
- [xAI Reasoning (model capabilities; reasoning_effort; per-model exposure)](https://docs.x.ai/developers/model-capabilities/text/reasoning)
- [Perplexity Sonar Reasoning Pro (`<think>` inline)](https://docs.perplexity.ai/docs/sonar/models/sonar-reasoning-pro)
- [Mistral native reasoning ([THINK]/ThinkChunk)](https://docs.mistral.ai/capabilities/reasoning/native)
- [OpenRouter reasoning tokens (unified `reasoning` object, `reasoning_details[].type`)](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) · [OpenRouter API parameters](https://openrouter.ai/docs/api/reference/parameters)

## Constraints the research surfaced (for a future plan to weigh)

Findings and constraints, not steps to execute. They inherit the body's line-540 stance: shapes/field names below are illustrative, and "should" marks a constraint to weigh, not a decision taken here.

- **Three-fact decomposition (candidate):** *capability* (static, per-model prediction), *occurrence* (durable: reasoning-token usage and/or duration), *displayable content* (durable: sanctioned reasoning-part text). Candidate render rules: render nothing unless capability says so; render a timer/affordance from occurrence; render text only from displayable content; render raw CoT never. (This matches the body's Recommended Mental Model; it is one decomposition, not a mandated schema.)
- **Finding: capability is the missing presentation input.** Verified — no model id/capability reaches `message-assistant.tsx` or `use-activity-panel.ts`; the affordance is gated on `"submitted"` + parts-presence. A plan that adds a capability gate as the outermost check would address the headline defect; everything else (pending placeholder, shimmer, parts-presence) is downstream of it.
- **Finding: static disclosure is a prediction; durably-observed exposure should override it** *when captured*. Grok-by-model and OpenRouter-by-upstream make any static-only disclosure wrong. (On abort/fail nothing is captured — see the conflict-resolution fallback order.)
- **Finding: one overloaded boolean cannot carry support + request-policy + display-policy.** Note the `tools: boolean | ToolCapabilities` union exists in the repo **but is exercised by zero catalog entries** — it is a declared-but-unused pattern, so a reasoning graduation would be the *first* object-form capability in the data files: treat it as a new pattern to validate, not a settled precedent to copy. The registry also already carries Anthropic-scoped `thinkingMode`/`thinkingBudget`, so it is one boolean *plus* a partial sub-model.
- **Constraint: keep provider names out of components.** Provider divergence already lives correctly in request-shaping and the history adapters; the display layer should consume normalized capability/parts/metadata.
- **Constraint: render history from send-time facts.** Each assistant row already stores its own `model`/`provider`; persisting send-time capability/exposure per row keeps history, regenerated siblings, share, and guest chats from inheriting the currently-selected model.
- **Finding: `use-reasoning-phase` encodes a resume-not-restart ticker** (the `isLast` true→false→true regenerate-handoff bounce) that any derivation layer must preserve — it is easy to regress.
- **Finding: reasoning-as-history replay is a separate, server-side concern** the display layer should not try to unify (three mechanisms, flag+provider-selected, openai/anthropic compilers only).
- **Constraint: neutral, non-anthropomorphic copy** given the faithfulness caveat — "Thinking"/"Thought for {n}" only inside the reasoning lane and only when capability is known; neutral "Generating" for the non-reasoning first-token window; specific tool verbs (or "Working") for the tool lane; never "Thinking" without reasoning capability; never a reasoning verb on a network-wait duration.
