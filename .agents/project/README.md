# Project Context

This is the canonical agent-facing project map. Keep it short and current; detailed historical research belongs in `.agents/research/` only when it is still useful.

## Stack

- Next.js 16 App Router with React 19.
- Convex for data, file storage, and reactive client data.
- Clerk for authentication.
- Vercel AI SDK v6 for provider routing, streaming, tool calls, reasoning, and source parts.
- Base UI primitives in `components/ui/`.
- Remix Icons for UI glyphs; custom brand icons live in `components/icons/`.

## Source Of Truth

- Public overview and local setup: `README.md` and `INSTALL.md`.
- Environment variables: `.env.example`.
- Agent rules: `AGENTS.md`, with `CLAUDE.md` as a small Claude-specific overlay.
- Convex schema and indexes: `convex/schema.ts`.
- Chat streaming route: `app/api/chat/route.ts`.
- AI SDK v6 guidance: `.agents/skills/ai-sdk-v6/SKILL.md`.
- Observability runbooks: `docs/observability/`.

## Implementation Patterns

- Use `result.toUIMessageStreamResponse({ sendReasoning: true, sendSources: true, onError })` for AI SDK v6 chat streams.
- Use `await convertToModelMessages(...)` before provider calls.
- Validate Clerk identity in Convex functions before user-scoped reads or writes, then verify ownership before mutation.
- Store user provider keys encrypted at rest through the existing BYOK path.
- Use optimistic UI with explicit rollback state for user-visible mutations.
- Prefer existing `components/ui/`, `components/common/`, and `app/components/chat/` patterns before adding abstractions.

## Validation

- Normal doc-only changes: run the targeted reference scan and markdown-link scan.
- Code or config changes: run `bun run lint`, `bun run typecheck`, and `bun run test`.
- Production-affecting changes: also run `bun run build:next` when feasible.

## Context Hygiene

- Do not reintroduce long living plans at the repo root.
- Delete stale planning docs instead of archiving them.
- Keep setup details in `INSTALL.md` and env details in `.env.example`; do not duplicate full env tables in agent docs.
- Keep provider/model data in source files, not dated research snapshots.
