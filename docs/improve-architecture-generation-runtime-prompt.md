# Prompt template: architecture pass biased toward the generation runtime core

> Copy-paste the block below as-is. It names areas by role rather than exact shape, so it stays valid as the code evolves.

---

Invoke the improve-codebase-architecture skill with a bias toward the generation runtime core — the server-side chat generation lifecycle spanning the Convex runtime module (currently `convex/chatRuntime.ts`) and the API turn runtime (currently `app/api/chat/chat-turn-runtime.ts` and its neighbors). Pay particular attention to god-module symptoms there: mixed responsibilities (intent application, run lifecycle state transitions, tool approvals, and read queries living in one file) and concurrency invariants enforced by scattered guards inside individual mutations rather than by an explicit structure such as a run state machine. Favor decompositions that make those lifecycle invariants durable and legible, consistent with CONTEXT.md and the existing ADRs.
