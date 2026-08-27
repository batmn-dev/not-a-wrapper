# ADR-0026: Per-turn reasoning effort with model-declared levels

**Status:** Accepted
**Date:** 2026-08-26

## Context

Reasoning-capable models accept a depth knob, but today the app hardcodes it:
OpenAI routes always send `reasoningEffort: "medium"`, Anthropic routes send a
fixed thinking mode/budget from the catalog, and OpenRouter routes bake
`reasoning: { effort: "medium" }` into model construction. The user has no
control, and every provider exposes a different level vocabulary:

- OpenAI: `none|minimal|low|medium|high|xhigh|max`, subset per family
  (gpt-5 takes `minimal` but not `none`; gpt-5.1+ the reverse; `max` from 5.6).
- Anthropic: `output_config.effort` `low|medium|high|xhigh|max` on 4.7+/5
  (`xhigh` absent on 4.6); older models take only `budget_tokens`.
- Google: `thinkingLevel` subsets per Gemini 3 model (3 Pro: `low|high` only);
  Gemini 2.5 takes numeric budgets instead.
- xAI: `low|medium|high(|xhigh)` on Grok 4.5/4.6; Grok 4 reasons
  unconditionally.
- OpenRouter: one normalized `reasoning.effort` enum, clamped to the nearest
  supported level per upstream model.

Two providers publish per-level support programmatically (Anthropic
`GET /v1/models` → `capabilities.effort.*.supported`; OpenRouter
`GET /api/v1/models` → `reasoning.supported_efforts`); the rest are docs-only
and must be snapshot data, consistent with ADR-0007/0022.

Product expectation (verified against shipped ChatGPT and Claude.ai behavior):
the choice is per turn, the menu shows only the selected model's real levels,
the conversation restores the effort that last actually ran, and switching
models keeps the level when supported or visibly snaps to a valid one.

This is the app's first per-message generation option; the pattern set here is
the template for later options.

## Decision

### Vocabulary

`ModelReasoningEffort` widens to the closed superset
`"none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`, ordered.
It is the app-wide canonical scale; provider mapping never invents levels. The
absence of a selection ("Default") is represented by `undefined`, never by a
sentinel level — Default means "send nothing, let the provider decide".

### Catalog (per-route facts, ADR-0020 discipline)

Two new optional `ModelConfig` fields:

- `effortLevels?: readonly ModelReasoningEffort[]` — the levels this route's
  provider accepts for this model, in canonical order. Absent → the route has
  no user-selectable effort (the effort control does not render for it).
- `defaultEffort?: ModelReasoningEffort` — the provider's documented default,
  presentation-only (marks the "Default" row); never sent on the wire.

`lib/models` stays provider-import-free (`model-runtime-boundary.test.ts`):
levels are vocabulary; the effort→wire mapping lives in `lib/openproviders`.

The logical view aggregates `effortLevels` as the ordered union across routes
(the client renders the menu of every level any route can serve), next to the
existing `searchMode`/`reasoningText` aggregation. Sources: the OpenRouter
generator emits `effortLevels` from `reasoning.supported_efforts`; direct
provider data files are hand-maintained snapshots with `verifiedAgainst`
evidence (an Anthropic models-API refresh script may automate that lane
later).

### Wire and trust boundary

`ChatTurnBodyFields` gains flat `reasoningEffort?: ModelReasoningEffort`,
beside `enableSearch`, so all three turn kinds (send, edit, regeneration)
carry it. It is untrusted input (ADR-0010): the parser drops unknown values,
and the runtime clamps the request to what the resolved route supports.

Route preference is soft: when at least one route of the logical model
supports the requested level, `RequiredRouteCapabilities.reasoningEffort`
filters resolution to those routes; when none does, resolution proceeds
unconstrained and the applied effort clamps to the route's nearest supported
level. An effort selection never fails a turn.

### Request shaping and receipts

`RequestShapingContext` gains `reasoningEffort?`; `shapeRequest` maps it per
provider (Anthropic `thinking` + `effort`, OpenAI `reasoningEffort`, Google
`thinkingLevel`, xAI `reasoningEffort`, OpenRouter per-call
`providerOptions.openrouter.reasoning`), falling back to today's defaults when
absent. The applied effort is recorded twice:

- `generationRuns.reasoningEffort` (requested) and `.appliedReasoningEffort`
  — the execution receipt, carried through the signed admission proof so the
  client cannot forge it.
- assistant message `metadata.reasoningEffort` (applied), stamped at stream
  start — the per-turn fact the UI badges and the composer restores from.

Platform-funded turns ignore the requested level in v1 (applied = provider
default) so ADR-0021 reservation math stays valid; BYOK turns honor every
catalog level. Requested is still recorded for transparency.

### Client resolution order

The composer's effective effort for the next turn resolves, first hit wins:

1. the user's in-conversation selection (Turn context state);
2. the last assistant message's `metadata.reasoningEffort` (reopened chats
   restore what actually ran — messages are the conversation memory; there is
   no per-chat server field);
3. the per-model last-used map (device-local, `lastUsedEffortByModel`);
4. Default (`undefined`).

On model switch the level carries over when the new model's aggregated levels
contain it, otherwise it snaps to Default — and the snap is written back to
state, not merely displayed. Unsupported levels are hidden, never disabled;
the whole control unmounts for models without `effortLevels`.

### Gating

One `NEXT_PUBLIC_REASONING_EFFORT_CONTROL` predicate function is the kill
switch; per-model visibility is catalog-driven, keeping rollout gating and
capability gating separate.

## Consequences

- The effort menu is provider-truth: it can differ per model and silently
  gains levels when catalog data (or the OpenRouter snapshot) updates.
- OpenRouter's construction-time `reasoning: { effort: "medium" }` remains the
  no-selection default; a per-call selection overrides it via provider
  options. If a future provider version drops per-call override, the effort
  must thread into `createLanguageModel` instead.
- Clamping means a receipt can differ from the request; the message badge and
  `generationRuns` keep both honest.
- Later work (not in scope): syncing the per-model map to `userPreferences`,
  a "try again with more thinking" regenerate item, and platform-funded
  effort with effort-scaled reservations.
