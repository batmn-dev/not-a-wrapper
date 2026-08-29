# ADR-0028: Generation output budget policy

**Status:** Accepted
**Date:** 2026-08-29

## Context

Providers do not share one safe default when maximum output tokens are
omitted. OpenRouter can forward a model's full output maximum and reject the
request before generation when the key balance cannot cover that worst case.
Other providers choose different defaults, and Anthropic requires
`max_tokens`; the AI SDK supplies it and adds fixed thinking tokens to the
generic `maxOutputTokens` value.

The runtime previously set `maxOutputTokens` only when Not A Wrapper paid for
the request. That coupled response length to credential ownership. It also
passed Anthropic's fixed-thinking headroom to the AI SDK even though the SDK
adds that headroom itself, so the provider request could exceed the amount the
allowance system reserved.

## Decision

Treat three facts separately:

1. `generationBudget` is an optional user choice for one turn. It is a total
   generation allowance, including hidden reasoning output. Absent means Auto.
2. Provider translation converts that total into the provider-facing value.
   Fixed Anthropic thinking is subtracted before setting the AI SDK's
   `maxOutputTokens`, because its adapter adds the fixed budget back.
3. Platform funding has its own response and reservation ceiling. An explicit
   user budget may lower it, never raise it.

BYOK Auto omits `maxOutputTokens`. We do not silently restrict a user's own
key. A user-selected budget applies identically to BYOK and platform-funded
requests, subject to the platform ceiling and the route's catalogued maximum.
Because AI SDK applies `maxOutputTokens` to each model call, the runtime
composes its existing `prepareStep` gate with the remaining turn allowance.
Each completed step's total output usage, including reasoning, reduces the
next call's provider limit. The loop stops when the allowance is exhausted or
when a provider omits trustworthy output usage; it never guesses through an
unknown spend boundary.

OpenRouter affordability failures remain terminal. The server recognizes the
documented `token_limit_exceeded` category when present, does not parse the
numeric "affordable tokens" text as a contract, and persists a structured
recovery hint. The failed turn offers a user-initiated retry with a
16,384-token total generation budget. There is no automatic retry because a
second generation can spend money, duplicate tool side effects, or produce a
different answer.

The durable generation run records requested and applied budgets. Assistant
metadata records the applied budget so an approval continuation preserves the
paused turn's policy instead of adopting later composer state.

The budget receipt changes the signed chat admission tuple to v4. Servers sign
and verify only v4, which binds `generationBudget` whether it is present or
Auto (`null`). There is no legacy proof path because the app has no users and
its data is disposable during pre-launch.

## Alternatives considered

- **Universal BYOK cap:** predictable and protects spend, but silently removes
  model capability and can truncate long or reasoning-heavy answers.
- **Model-specific automatic defaults:** more compatible, but turns a large,
  changing provider matrix into product policy and still guesses what each
  user can afford.
- **Retry automatically after a 402:** convenient for one gateway error, but
  unsafe across tools and unreliable without a stable numeric affordability
  field.
- **Always-visible advanced setting:** flexible, but adds permanent composer
  complexity for a rare failure. The first surface is contextual recovery;
  the wire and runtime contract can support a broader control later.

## Consequences

- BYOK behavior stays provider-native in Auto mode and becomes predictable
  only when the user explicitly chooses a budget.
- Platform funding remains bounded independently of BYOK policy.
- Reasoning can consume most or all of a total generation budget, so a shorter
  retry may produce less visible text.
- A fixed Anthropic model rejects an explicit budget that cannot fit its fixed
  reasoning allocation rather than silently exceeding the user's choice.
- Provider defaults can still change; the model catalog and provider adapter
  remain the compatibility boundary.

## Implementation boundaries

- `lib/openproviders/output-budget.ts`: pure policy and provider translation
- `lib/openproviders/request-shaping.ts`: fixed-thinking facts
- `lib/model-route-resolver.ts` and `lib/usage/platform-usage-estimate.ts`:
  platform reservation
- `lib/chat-messages/chat-turn-contract.ts` and `lib/chat-turn/`: turn intent
- `app/api/chat/`: runtime application and public provider errors
- `convex/chatRuntime.ts`, `convex/schema.ts`, and admission proof: durable
  receipts
- `app/components/chat/`: contextual manual retry and approval continuation
