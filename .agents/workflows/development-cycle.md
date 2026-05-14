# Workflow: Development Cycle

Use this workflow for non-trivial changes. Keep it lightweight for low-risk work and increase rigor for auth, schema, persistence, API contracts, concurrency, billing, or security-sensitive paths.

## 1. Explore

- Read the relevant source first.
- Search for existing patterns before proposing new abstractions.
- Use `AGENTS.md`, `README.md`, and `INSTALL.md` for current project context.
- Use `.agents/research/` only when a current decision depends on background research.

## 2. Decide

- For medium/high-risk changes, write a brief approach decision: options, trade-offs, and chosen path.
- Do not add dependencies or change major configs without explicit approval.
- Prefer extending existing patterns over parallel systems.

## 3. Implement

- Keep edits scoped to the requested behavior.
- Update docs only when behavior, setup, or agent guidance actually changes.
- Preserve user work in dirty files.

## 4. Validate

Run checks scaled to the change:

```bash
bun run lint
bun run typecheck
bun run test
```

Use `bun run build:next` for production-build-sensitive changes.

## References

- `AGENTS.md` — project rules and required patterns.
- `CLAUDE.md` — Claude-specific overlay.
- `.agents/workflows/correctness-decision-workflow.md` — risk-based correctness workflow.
- `README.md` and `INSTALL.md` — current setup and system map.
