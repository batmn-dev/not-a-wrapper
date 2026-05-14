# AI Module Context

`lib/ai/` contains small shared AI utilities. Do not treat every file here as active product behavior.

## Active Surface

- `message-conversion.ts`: adapts AI SDK UI messages into provider-ready model messages.
- `context-management.ts`: token estimation, placeholder compaction helpers, structured-note formatting, and Anthropic beta-header helpers.
- `index.ts`: central exports.

## Experimental Surface

- `sub-agents/`: typed placeholder architecture for task classification and future delegation. It is not wired into production chat behavior.

## Rules

- Use Vercel AI SDK v6 patterns from `.agents/skills/ai-sdk-v6/SKILL.md`.
- Keep provider-specific adaptation in the route/adapters that already own it.
- Do not add new long-form rationale docs here; update this file or `.agents/project/README.md` with concise current facts.
