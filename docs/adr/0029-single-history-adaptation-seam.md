# 0029 — One history-adaptation seam

**Status:** accepted
**Date:** 2026-08-30
**Related:** ADR-0006, ADR-0020

## Context

Chat history had two replay paths behind `HISTORY_REPLAY_COMPILER_V1`:

1. the provider adapter registry used by default; and
2. an experimental normalize → compiler → adapter pipeline.

The compiler covered only OpenAI and Anthropic, fell back to the adapter for
every other provider, and still passed successful compiler output through the
adapter. Its normalized representation also discarded canonical parts such as
reasoning before the provider adapter could apply its own policy. Callers,
telemetry, and tests therefore carried two behavior matrices without gaining a
complete second adapter.

## Decision

History adaptation has one seam: `adaptHistoryForProvider` selects one
target-provider adapter from the registry. Before that seam, the Chat turn
runtime separates approval continuations and lowers historical
provider-executed activity to provider-neutral text. After it, model-bound
validation fails closed before conversion and provider execution.

Delete the compiler flag, compiler implementation, fallback telemetry, and
compiler-only tests. Keep the final provider-request matrix as the end-to-end
contract across every origin, target, and search-policy combination.

## Consequences

- Every provider follows the same runtime path.
- Provider-specific replay behavior stays local to its adapter.
- Canonical history is not narrowed by a second intermediate representation.
- New provider behavior must extend the adapter registry and shared request
  matrix instead of introducing another rollout path.
