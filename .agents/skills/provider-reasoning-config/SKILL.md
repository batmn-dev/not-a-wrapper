---
name: provider-reasoning-config
description: Correctly configure providerOptions for reasoning/thinking models across Anthropic, Google, OpenAI, and xAI, including the Anthropic adaptive thinking mode and search tool interaction workaround. Use when adding reasoning support for a new model, modifying thinking/reasoning display, fixing issues with extended thinking output, changing providerOptions in route.ts, or adding a new reasoning-capable model.
---

# Provider Reasoning Configuration

Use this skill when configuring, debugging, or extending reasoning/thinking support for any AI provider. Covers the full path from model config through `providerOptions` to client-side rendering.

## Prerequisites

- [ ] You know which provider and model you're configuring.
- [ ] You can reference `app/api/chat/route.ts` (lines 664–736) for the `providerOptions` block.
- [ ] You can reference `lib/models/types.ts` for `ModelConfig` type.

## Quick Reference

| Provider | providerOptions Key | Config Shape | Models |
|----------|-------------------|--------------|--------|
| Anthropic | `anthropic.thinking` | `{ type: "adaptive" }` or `{ type: "enabled", budgetTokens }` | Opus 4.6 (adaptive), Sonnet 4.6 (adaptive), Haiku 4.5 (enabled) |
| Google | `google.thinkingConfig` | `{ includeThoughts: true }` | Gemini 2.5 Pro, Gemini 2.5 Flash |
| OpenAI | `openai.reasoningEffort` + `openai.reasoningSummary` | `"medium"` + `"auto"` | GPT-5.4, GPT-5.4 Pro, GPT-5 Mini |
| xAI | `xai.reasoningEffort` | `"medium"` | Grok 4.1 Fast |

## Reasoning Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Model Config (lib/models/data/*.ts)                          │
│    reasoningText: true  → enables providerOptions block         │
│    thinkingMode: "adaptive" | "enabled" | undefined             │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. providerOptions (route.ts:690-736)                           │
│    Conditional block builds provider-specific config             │
│    ├─ Anthropic: 3 code paths (adaptive, search workaround,    │
│    │             legacy enabled)                                 │
│    ├─ Google: thinkingConfig.includeThoughts                    │
│    ├─ OpenAI: reasoningEffort                                   │
│    └─ xAI: reasoningEffort                                      │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. streamText (route.ts:771+)                                   │
│    providerOptions passed to streamText()                       │
│    Provider SDK interprets and sends to API                     │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Stream Response (route.ts:1150-1157)                         │
│    toUIMessageStreamResponse({ sendReasoning: true })           │
│    Reasoning parts included in SSE stream                       │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Client Rendering                                             │
│    useReasoningPhase() → phase, reasoningText, durationSeconds  │
│    <Reasoning> component → collapsible thinking display         │
└─────────────────────────────────────────────────────────────────┘
```

## ModelConfig Fields for Reasoning

```typescript
// lib/models/types.ts
type ModelConfig = {
  // ...
  reasoningText?: boolean    // Enables the providerOptions block
  thinkingMode?: "adaptive"  // Opus 4.6+ dynamic allocation
                | "enabled"  // Fixed budget via budgetTokens
                | undefined  // Inherits from reasoningText (backward compat)
  maxOutput?: number         // Max output tokens (used for budget calculation)
}
```

| Field | Purpose | Example Values |
|-------|---------|---------------|
| `reasoningText` | Gates the entire providerOptions reasoning block | `true` for reasoning models |
| `thinkingMode` | Anthropic-specific: controls adaptive vs fixed budget | `"adaptive"` (Opus 4.6), undefined (Sonnet 4.5) |
| `maxOutput` | Max output tokens, used for budget sizing | `128000` (Opus 4.6), `64000` (Sonnet 4.5) |

## Provider-Specific Configuration

### Anthropic (3 code paths)

The Anthropic configuration has the most complexity due to adaptive thinking, model-specific budgets, and a search tool interaction workaround.

**Path 1: Adaptive mode (Opus 4.6+, no search)**

```typescript
if (modelConfig.thinkingMode === "adaptive" && !shouldInjectSearch) {
  providerOptions.anthropic = {
    thinking: { type: "adaptive" },
  }
}
```

The model dynamically allocates between thinking and text output. Recommended by Anthropic for Opus 4.6+.

**Path 2: Search workaround (adaptive model + search active)**

```typescript
if (modelConfig.thinkingMode === "adaptive" && shouldInjectSearch) {
  providerOptions.anthropic = {
    thinking: { type: "enabled", budgetTokens: 10000 },
  }
}
```

**Why:** When adaptive thinking is used with server-side search tools, the Anthropic API may return `stop_reason: "pause_turn"`. The AI SDK maps `pause_turn` to the same unified `finishReason` as `end_turn` (`"stop"`) and doesn't re-send the conversation. This results in responses with reasoning + tool results but zero text content. Falling back to `"enabled"` with a fixed budget avoids `pause_turn` entirely.

**Path 3: Legacy enabled (older models)**

```typescript
// No thinkingMode set, or thinkingMode === "enabled"
let budgetTokens = 10000 // default
if (model.includes("opus")) budgetTokens = 16000
else if (model.includes("haiku")) budgetTokens = 5000
else if (model.includes("sonnet")) budgetTokens = 12000

providerOptions.anthropic = {
  thinking: { type: "enabled", budgetTokens },
}
```

Model-specific budgets balance thinking depth with response speed.

### Google

```typescript
if (provider === "google") {
  providerOptions.google = {
    thinkingConfig: { includeThoughts: true },
  }
}
```

Simple boolean toggle. Google models with thinking support (Gemini 2.5 Pro/Flash) will include thought content in their response.

### OpenAI

```typescript
if (provider === "openai") {
  providerOptions.openai = {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
  }
}
```

`reasoningEffort` values: `"low"`, `"medium"`, `"high"`. Controls how much reasoning the model produces. `"medium"` balances quality with speed.

`reasoningSummary` values: `"auto"`, `"detailed"`. Controls whether the model returns visible reasoning text. `"auto"` returns a condensed summary; `"detailed"` returns comprehensive reasoning. Without this option, reasoning parts arrive with empty text (the model reasons internally but the API doesn't expose it). Requires the Responses API (default in AI SDK v5+).

### xAI (Grok)

```typescript
if (provider === "xai") {
  providerOptions.xai = {
    reasoningEffort: "medium",
  }
}
```

Same interface as OpenAI.

## Client-Side Rendering

### Reasoning Phase Hook

`useReasoningPhase()` in `app/components/chat/use-reasoning-phase.ts` extracts phase from UIMessage parts:

```typescript
type ReasoningPhase = {
  phase: "idle" | "thinking" | "complete"
  reasoningText: string
  durationSeconds: number | undefined
  isReasoningStreaming: boolean
  isOpaqueReasoning: boolean
}
```

| Phase | Condition | UI |
|-------|-----------|-----|
| `idle` | No reasoning parts | Nothing rendered |
| `thinking` | Reasoning part with `state === "streaming"` or no text yet | Shimmer label, live timer, open collapsible |
| `complete` | Reasoning part with `state === "done"` or terminal status | Frozen timer, closed collapsible |

`isOpaqueReasoning` is `true` when reasoning parts exist but the concatenated text is empty. This happens when a model reasons internally without returning visible text (e.g., OpenAI without `reasoningSummary`). When opaque, the Reasoning component renders a non-expandable label without the toggle chevron or content area.

The hook:
1. Filters parts for `type === "reasoning"`
2. Concatenates text from all reasoning parts (GPT may emit multiple)
3. Checks `state` field: `"streaming"` → thinking, `"done"` → complete
4. Runs a client-side timer while `isLast && phase === "thinking"`

### Reasoning Component

`components/ui/reasoning.tsx` renders a collapsible container:

- **Auto-opens** when streaming starts (`isStreaming` transitions to `true`)
- **Auto-closes** when streaming ends
- Uses React 19 render-sync pattern (not useEffect) for state transitions
- Phase-aware label shows shimmer during thinking, duration after completion
- Markdown rendering for reasoning content

### Integration in MessageAssistant

```typescript
// message-assistant.tsx
const { phase: reasoningPhase, reasoningText, durationSeconds, isReasoningStreaming } =
  useReasoningPhase({
    parts,
    status: status ?? "ready",
    isLast: isLast ?? false,
  })

// Only renders when reasoning exists
{reasoningPhase !== "idle" && (
  <Reasoning
    isStreaming={isReasoningStreaming}
    phase={reasoningPhase}
    durationSeconds={durationSeconds}
  >
    <ReasoningLabel />
    <ReasoningContent markdown>{reasoningText}</ReasoningContent>
  </Reasoning>
)}
```

## Step-by-Step: Adding Reasoning for a New Model

1) **Update model config**
- [ ] Set `reasoningText: true` in the model's data file (`lib/models/data/{provider}.ts`).
- [ ] Set `thinkingMode` if Anthropic (`"adaptive"` or `"enabled"`); omit for other providers.

2) **Add providerOptions branch (if new provider)**
- [ ] Add `else if (provider === "newProvider")` in `route.ts` providerOptions block.
- [ ] Configure the provider-specific reasoning options per SDK docs.

3) **Verify stream includes reasoning**
- [ ] Confirm `sendReasoning: true` in `toUIMessageStreamResponse()` (already set globally).
- [ ] Test that reasoning parts appear in the SSE stream.

4) **Verify client rendering**
- [ ] Confirm `useReasoningPhase()` detects reasoning parts (no changes needed for standard `ReasoningUIPart`).
- [ ] Confirm `<Reasoning>` component renders with shimmer during streaming and frozen display after completion.

5) **Test with search tools**
- [ ] If Anthropic: verify the search workaround triggers when `shouldInjectSearch` is true.
- [ ] Confirm the model produces text content (not just reasoning + tool results).

## Step-by-Step: Adding Reasoning for a New Provider

1) **Research the provider's reasoning API**
- [ ] Check the AI SDK provider package docs for providerOptions schema.
- [ ] Identify the config key (e.g., `anthropic.thinking`, `google.thinkingConfig`).

2) **Add providerOptions branch**
- [ ] In `route.ts` (inside the `if (modelConfig.reasoningText)` block):

```typescript
else if (provider === "newProvider") {
  providerOptions.newProvider = {
    // Provider-specific reasoning config
  }
}
```

3) **Update ModelConfig type if needed**
- [ ] If the provider has unique thinking modes, consider extending `thinkingMode` union.
- [ ] Document the new values in the type's JSDoc.

4) **Update model data files**
- [ ] Set `reasoningText: true` and any mode-specific fields.

5) **Verify end-to-end**
- [ ] Reasoning appears in stream
- [ ] Client renders correctly
- [ ] No interaction issues with search tools

## Key Design Decisions

**Why `reasoningText` gates the entire block:**
Not all models support reasoning. Models without `reasoningText: true` skip the providerOptions entirely, avoiding SDK errors from sending unsupported options.

**Why Anthropic has model-specific budgets:**
Different models have different capabilities. Opus (16K budget) benefits from deeper thinking; Haiku (5K budget) is optimized for speed where deep reasoning isn't needed.

**Why reasoningEffort is "medium" for OpenAI/xAI:**
Balances quality with latency. Users don't currently have a UI to configure this, so "medium" is a safe default.

**Why reasoningSummary is "auto" for OpenAI:**
Without `reasoningSummary`, OpenAI reasoning models produce `reasoning-delta` stream events with empty text — the model reasons internally but doesn't expose it. The `"auto"` setting returns a condensed summary. The UI has a fallback ("opaque reasoning") that handles empty text gracefully, but `"auto"` provides actual content users can inspect.

**Why the search workaround exists:**
This is an SDK limitation (not an Anthropic API limitation). When the SDK receives `stop_reason: "pause_turn"`, it doesn't continue the conversation, resulting in truncated responses. The workaround avoids the `pause_turn` entirely by using fixed-budget thinking.

## Gotchas

1. **`reasoningText: true` without providerOptions** — If a model has `reasoningText: true` but its provider isn't in the `if/else` chain, no providerOptions are set and the provider may not produce reasoning output. Always add a branch for new providers.
2. **`sendReasoning` defaults to `true`** — The SDK default sends reasoning, and the codebase explicitly sets it. Don't set to `false` unless deliberately hiding reasoning.
3. **`sendSources` defaults to `false`** — Unlike reasoning, source citations must be opted into.
4. **Anthropic adaptive + search = truncated output** — The `pause_turn` workaround is critical. Don't remove the `shouldInjectSearch` check without verifying the SDK handles `pause_turn`.
5. **Multiple reasoning parts** — OpenAI models may emit multiple `ReasoningUIPart` objects. `useReasoningPhase` concatenates them with `\n\n`.
6. **Reasoning part `state` field** — Can be `"streaming"`, `"done"`, or `undefined`. The hook handles all three cases.
7. **Budget doesn't reduce for search** — Anthropic web search results count as INPUT tokens, not output. The `budgetTokens` doesn't need reduction when search is active.
8. **`thinkingMode: undefined`** — For backward compatibility, models without an explicit `thinkingMode` still get reasoning if `reasoningText: true`. They fall into the legacy "enabled" path with model-name-based budget sizing.
9. **OpenAI `reasoningSummary` is Responses API only** — The `reasoningSummary` option requires the Responses API (default in AI SDK v5+). It has no effect if the model is created via `openai.chat()` instead of `openai()` or `openai.responses()`.

## Do / Don't

**Do**
- Set `reasoningText: true` in model config for all reasoning-capable models
- Set `reasoningSummary: "auto"` in providerOptions for OpenAI reasoning models
- Set `thinkingMode: "adaptive"` for Anthropic models that support it (Opus 4.6+)
- Test reasoning with and without search tools enabled (especially Anthropic)
- Check the `phase` from `useReasoningPhase()` for rendering decisions

**Don't**
- Set `budgetTokens` higher than the model's `maxOutput` (causes API errors)
- Remove the `shouldInjectSearch` workaround without verifying SDK `pause_turn` handling
- Add `reasoningText: true` without adding the provider to the `providerOptions` chain
- Set OpenAI `reasoningEffort` without `reasoningSummary` (produces empty reasoning parts)
- Assume reasoning parts exist during streaming — always check `phase !== "idle"`

## Internal References

- providerOptions block: `app/api/chat/route.ts` (lines 664–736)
- ModelConfig type: `lib/models/types.ts`
- Model data: `lib/models/data/{claude,openai,gemini,grok}.ts`
- Stream response: `app/api/chat/route.ts` (lines 1150–1157)
- Reasoning phase hook: `app/components/chat/use-reasoning-phase.ts`
- Reasoning component: `components/ui/reasoning.tsx`
- Message rendering: `app/components/chat/message-assistant.tsx`

## External References

- Anthropic extended thinking: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
- Anthropic adaptive thinking: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#adaptive-thinking
- Google Gemini thinking: https://ai.google.dev/gemini-api/docs/thinking
- OpenAI reasoning: https://platform.openai.com/docs/guides/reasoning
- AI SDK providerOptions: https://ai-sdk.dev/docs/ai-sdk-core/settings#provider-options
- AI SDK Anthropic provider: https://ai-sdk.dev/providers/ai-sdk-providers/anthropic
- AI SDK Google provider: https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai
